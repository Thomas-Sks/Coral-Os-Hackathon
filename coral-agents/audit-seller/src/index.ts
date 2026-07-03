/**
 * AuditMesh seller agent — sells a security assessment in the CoralOS market.
 *
 * Flow (one persona; three run in the demo):
 *   WANT ─▶ BID ─▶ AWARD ─▶ [receive AUTHZ_GRANT] ─▶ verify consent ─▶ AUTHZ_RESULT
 *        ─▶ ESCROW_REQUIRED (reference bound to the authorization hash) ─▶ DEPOSITED (verify funded)
 *        ─▶ deliver (recon→analysis→reporting, streaming DELIVERY_PROGRESS) ─▶ DELIVERED <report>
 *
 * The authorization gate is enforced here, not assumed: the seller re-verifies the buyer's signed,
 * scoped, live-domain-control-checked grant before it emits ESCROW_REQUIRED, and again (live) inside
 * delivery. A missing or invalid grant ⇒ AUTHZ_RESULT rejected and NO work — the money never moves.
 */
import type { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import {
  startCoralAgent, verb, parseWant, formatBid, parseAward, formatEscrowRequired, parseDeposited,
} from '@pay/agent-runtime'
import {
  AUDIT_SERVICE, formatAuthzResult, formatDeliveryProgress, parseAuthzGrant,
  type SignedAuthorization,
} from '@auditmesh/shared'
import { decodeGrant, verifyAuthorization, deriveEscrowReference } from '@auditmesh/authorization'
import { decideBid, sellerConfigFromEnv } from './bidder.js'
import { makeProgram, isFunded } from './escrow.js'
import { deliverAudit } from './service.js'

const NAME = process.env.AGENT_NAME ?? 'audit-seller'
const SELLER_WALLET = process.env.SELLER_WALLET ?? ''
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? '600')
const SETTLEMENT_MODE = (process.env.SETTLEMENT_MODE ?? 'arbiter').toLowerCase() === 'direct' ? 'direct' : 'arbiter'
const cfg = sellerConfigFromEnv(NAME)
const trace = process.env.TRACE === '1'
const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

interface AwardCtx { round: number; priceSol: number; signed: SignedAuthorization; reference: string }
const quoted = new Map<number, number>() // round -> quoted priceSol
const grants = new Map<number, SignedAuthorization>() // round -> received grant
const pendingAward = new Map<number, number>() // round -> priceSol, awaiting its grant
const awarded = new Map<string, AwardCtx>() // reference -> awarded deal

let program: Program | null = null
const escrowProgram = async (): Promise<Program> => (program ??= await makeProgram(RPC))

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  console.error(`[${NAME}] ready: strategy=${cfg.strategy} floor=${cfg.floorSol} offers=[${cfg.offeredCategories.join(',')}] settlement=${SETTLEMENT_MODE} wallet=${SELLER_WALLET}`)

  /** Once BOTH the award and the grant for a round are in hand: verify consent and open escrow. */
  async function proceedIfReady(round: number, mention: { threadId?: string; text: string }): Promise<void> {
    const priceSol = pendingAward.get(round)
    const signed = grants.get(round)
    if (priceSol === undefined || !signed) return

    const verdict = await verifyAuthorization(signed, { nowMs: Date.now() })
    if (!verdict.ok) {
      console.error(`[${NAME}] round ${round}: authorization REJECTED (${verdict.code}) — no work`)
      await ctx.reply(mention, formatAuthzResult({ round, hash: signed.authzHash, status: 'rejected', code: verdict.code, detail: verdict.reason }))
      pendingAward.delete(round); grants.delete(round)
      return
    }
    await ctx.reply(mention, formatAuthzResult({ round, hash: signed.authzHash, status: 'verified' }))

    const reference = deriveEscrowReference(signed.authzHash, round).toBase58()
    awarded.set(reference, { round, priceSol, signed, reference })
    pendingAward.delete(round)
    if (trace) console.error(`[${NAME}] round ${round}: consent verified, ESCROW_REQUIRED ref=${reference.slice(0, 8)}…`)
    await ctx.reply(mention, formatEscrowRequired({
      round, reference, seller: SELLER_WALLET, amountSol: priceSol,
      deadlineSecs: ESCROW_DEADLINE_SECS, settlement: SETTLEMENT_MODE,
    }))
  }

  while (true) {
    try {
      const mention = await ctx.waitForMention()
      if (!mention) continue
      const text = mention.text.trim()
      if (trace) console.error(`[${NAME}] <- ${text.slice(0, 120)}`)

      // 1. WANT — bid per persona.
      const want = parseWant(text)
      if (want) {
        const decision = await decideBid(want, cfg)
        if (decision.bid) {
          quoted.set(want.round, decision.priceSol)
          await ctx.reply(mention, formatBid({ round: want.round, priceSol: decision.priceSol, by: NAME, note: decision.note }))
        } else if (trace) {
          console.error(`[${NAME}] no bid on round ${want.round}: ${decision.note}`)
        }
        continue
      }

      // 2. AUTHZ_GRANT — the buyer hands us the signed grant (may arrive before or after AWARD).
      const grantMsg = parseAuthzGrant(text)
      if (grantMsg) {
        const decoded = decodeGrant(grantMsg.token)
        if (decoded.ok) {
          grants.set(grantMsg.round, decoded.signed)
          await proceedIfReady(grantMsg.round, mention)
        } else if (trace) {
          console.error(`[${NAME}] round ${grantMsg.round}: undecodable grant — ${decoded.reason}`)
        }
        continue
      }

      // 3. AWARD — we won; wait for (or use the already-received) grant, then verify + open escrow.
      const award = parseAward(text)
      if (award) {
        const priceSol = quoted.get(award.round)
        if (award.to !== NAME || priceSol === undefined) continue
        quoted.delete(award.round)
        pendingAward.set(award.round, priceSol)
        await proceedIfReady(award.round, mention)
        continue
      }

      // 4. DEPOSITED — verify the escrow is funded, then deliver the assessment.
      const deposited = parseDeposited(text)
      if (deposited) {
        const order = awarded.get(deposited.reference)
        if (!order) { await ctx.reply(mention, `ERROR: unknown reference ${deposited.reference}`); continue }
        try {
          const escrowBuyer = deposited.settlement === 'arbiter' && deposited.vault ? deposited.vault : deposited.buyer
          const funded = await isFunded(await escrowProgram(), new PublicKey(escrowBuyer), new PublicKey(SELLER_WALLET), new PublicKey(deposited.reference), order.priceSol)
          if (!funded) { await ctx.reply(mention, `ERROR: escrow not funded for reference=${deposited.reference}`); continue }
          awarded.delete(deposited.reference)
          if (trace) console.error(`[${NAME}] escrow funded (${deposited.settlement ?? 'direct'}) — delivering round ${deposited.round}`)

          // Stream the delivery graph (recon → analysis → reporting) onto the market thread.
          const onProgress = async (ev: import('@auditmesh/shared').DeliveryProgressEvent) =>
            ctx.reply(mention, formatDeliveryProgress(ev))
          const result = await deliverAudit(order.signed, deposited.round, { onProgress, nowMs: Date.now() })

          if (result.ok) {
            await ctx.reply(mention, `DELIVERED round=${deposited.round} ${result.serialized}`)
            if (trace) console.error(`[${NAME}] round ${deposited.round}: DELIVERED (${result.report.summary.totalFindings} findings)`)
          } else {
            console.error(`[${NAME}] round ${deposited.round}: delivery failed (${result.code}) — no DELIVERED, buyer refunds`)
          }
        } catch (e) {
          await ctx.reply(mention, `ERROR: delivery failed - ${(e as Error).message}`)
        }
        continue
      }

      if (verb(text) === 'ARBITER_RELEASED' || verb(text) === 'RELEASED') {
        if (trace) console.error(`[${NAME}] ${text} ${text.match(/sig=(\S+)/) ? expl('tx', text.match(/sig=(\S+)/)![1]) : ''}`)
      }
    } catch (e) {
      console.error(`[${NAME}] loop error: ${e}`)
    }
  }
})
