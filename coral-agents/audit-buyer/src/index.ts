/**
 * AuditMesh buyer agent — the marketplace buyer for security assessments.
 *
 *   WANT (service=audit, scope, budget) ─▶ collect competing BIDs ─▶ AWARD best value
 *     ─▶ issue a SIGNED, SCOPED authorization for the target & hand it to the winner (AUTHZ_GRANT)
 *     ─▶ wait ESCROW_REQUIRED, assert its reference is bound to the authorization hash
 *     ─▶ deposit into escrow ─▶ DEPOSITED ─▶ wait DELIVERED
 *     ─▶ DECISION-TO-PAY: evaluate the delivered report, then release() to the seller
 *
 * The distinctive step is consent: the buyer proves control of the target (a nonce published at the
 * front-door's /.well-known) and signs a scoped grant with its Solana keypair. The escrow reference
 * is derived from that grant's hash, so "was this authorized?" is answered on-chain at settlement.
 * Best-value selection is LLM-driven within a code-enforced budget; a deterministic fallback keeps a
 * slow/missing model from hanging the round.
 *
 * The deposit/release calls settle against the devnet escrow — they need a funded wallet + live RPC,
 * so they run in a live market session, not in `npm test`/CI.
 */
import {
  startCoralAgent, complete, parseJsonReply, loadKeypairB58,
  formatWant, parseBid, parseEscrowRequired, formatAward, formatDeposited,
  selectBids, pickCheapest, verb, messageRound,
  type Bid, type EscrowTerms, type CoralAgentContext,
} from '@pay/agent-runtime'
import {
  AUDIT_SERVICE, encodeScopeArg, decodeScopeArg, formatAuthzGrant, safeParseReport, createLogger,
  Scope, type TestCategory,
} from '@auditmesh/shared'
import { issueAuthorization, encodeGrant, deriveEscrowReference } from '@auditmesh/authorization'
import { PublicKey } from '@solana/web3.js'
import { makeProgram, deposit, release, escrowPda } from './escrow.js'
import {
  ARBITER_PROGRAM_ID, ensureArbiterConfig, ensureArbiterFunded, makeArbiter,
  openArbitrated, arbitrateRelease, arbitratedEscrowPda,
} from './arbiter.js'
import { payoutMatches } from './guard.js'

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const BUDGET = Number(process.env.BUYER_MAX_SOL ?? '0.02')
const TARGET = process.env.AUDIT_TARGET ?? 'http://target-frontdoor'
const NONCE = process.env.AUTHZ_NONCE ?? '' // the token published at the target's /.well-known
// Rotate scope requests so consecutive rounds differ and different personas win (short codes joined by +).
const SCOPES = (process.env.AUDIT_SCOPES || 'hdr+tls,hdr+tls+xss+inj+ac+data,hdr+tls+xss')
  .split(',').map((s) => s.trim()).filter(Boolean)
const SCOPE_EXCLUSIONS = (process.env.AUDIT_EXCLUSIONS || '/#/administration')
  .split(',').map((s) => s.trim()).filter(Boolean)
const SCOPE_DEPTH = Number(process.env.AUDIT_DEPTH ?? '3')
const AUTHZ_TTL_SECS = Number(process.env.AUTHZ_TTL_SECS ?? '1800')
const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? '5000')
const CYCLE_MS = Number(process.env.CYCLE_INTERVAL_MS ?? '30000')
// How long the buyer waits for DELIVERED. With a live per-round Strix scan delivery takes minutes, so
// this must be generous (prebaked delivery is near-instant).
const DELIVERED_WAIT_MS = Number(process.env.DELIVERED_WAIT_MS ?? '1200000')
const SELLERS = (process.env.MARKET_SELLERS ?? 'audit-discounter,audit-tls-specialist,audit-premium')
  .split(',').map((s) => s.trim()).filter(Boolean)
const EXPECTED_SELLER_WALLET = process.env.SELLER_WALLET ?? ''
const SETTLEMENT_MODE = (process.env.SETTLEMENT_MODE ?? 'arbiter').toLowerCase()
const trace = process.env.TRACE === '1'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

/** Best-value selection via LLM; deterministic cheapest fallback. Returns winner + its reasoning. */
async function pickWinner(pool: Bid[], scopeLabels: string): Promise<{ winner: Bid; reason?: string }> {
  if (pool.length === 1) return { winner: pool[0], reason: 'only bidder' }
  try {
    const system =
      'You are a buyer choosing the best-value bid for a website security assessment, weighing several ' +
      'competing sellers. Weigh each seller\'s pitch — coverage, focus, and depth — against its price, ' +
      'staying within budget. Do NOT just pick the cheapest. In "reason", justify your choice in ONE ' +
      'sentence (under 28 words) that explicitly contrasts the winner against the rivals you passed on. ' +
      'Reply ONLY with JSON {"by": "<seller name>", "reason": "<your justification>"}.'
    const user =
      `requested_scope=[${scopeLabels}] budget=${BUDGET} SOL\ncompeting bids:\n` +
      pool.map((b) => `- ${b.by}: ${b.priceSol} SOL — "${b.note ?? ''}"`).join('\n')
    const parsed = parseJsonReply<{ by?: string; reason?: string }>(await complete({ system, user, maxTokens: 160 }))
    const chosen = pool.find((b) => b.by === parsed?.by)
    if (chosen) return { winner: chosen, reason: parsed?.reason }
  } catch {
    /* fall through to deterministic choice */
  }
  return { winner: pickCheapest(pool)!, reason: 'cheapest available' }
}

/** Wait (bounded) for a message matching `round` that `parse` accepts. */
async function waitFor<T>(
  ctx: CoralAgentContext,
  round: number,
  parse: (text: string) => (T & { round: number }) | null,
  maxMs: number,
): Promise<T | null> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    // Poll in ≤25s chunks: a single long MCP wait trips coral's transport timeout (-32001).
    const m = await ctx.waitForMention(Math.min(25_000, Math.max(500, deadline - Date.now())))
    if (!m) continue
    const parsed = parse(m.text)
    if (parsed && parsed.round === round) return parsed
  }
  return null
}

await startCoralAgent({ agentName: process.env.AGENT_NAME ?? 'audit-buyer' }, async (ctx) => {
  const buyer = loadKeypairB58('BUYER_KEYPAIR_B58')
  const arbiter = SETTLEMENT_MODE === 'arbiter' ? loadKeypairB58('ARBITER_KEYPAIR_B58') : null
  const log = createLogger('audit-buyer', { component: 'buyer', level: trace ? 'debug' : 'info' })
  console.error(`[buyer] AuditMesh buyer — wallet=${buyer.publicKey.toBase58()} budget=${BUDGET} target=${TARGET} sellers=[${SELLERS.join(',')}]`)
  if (!NONCE) console.error('[buyer] WARNING: AUTHZ_NONCE unset — publish a token at the target and pass AUTHZ_NONCE, or the seller will reject consent (that path is itself demoable).')

  for (const s of SELLERS) {
    try { await ctx.waitForAgent(s, 8000) } catch { /* seller may already be present */ }
  }
  const thread = await ctx.createThread('market', SELLERS)
  const program = await makeProgram(buyer, RPC)
  if (arbiter) {
    await ensureArbiterConfig(buyer, arbiter.publicKey, RPC)
    await ensureArbiterFunded(buyer, arbiter.publicKey, RPC)
  }
  let round = 0

  while (true) {
    try {
      round++
      const scopeArg = SCOPES[(round - 1) % SCOPES.length]
      const categories = decodeScopeArg(scopeArg)
      const scopeLabels = categories.join(', ')
      const arg = encodeScopeArg(categories) // canonicalize
      const correlationId = `am-r${round}-${(NONCE || 'nononce').slice(0, 8)}`
      log.event('want', { round, scope: scopeLabels, budget: BUDGET })
      await ctx.send(formatWant({ round, service: AUDIT_SERVICE, arg, budgetSol: BUDGET }), thread, SELLERS)

      // -- collect competing bids during the window --------------------------
      const bids: Bid[] = []
      const deadline = Date.now() + BID_WINDOW_MS
      while (Date.now() < deadline) {
        // Poll in ≤25s chunks: a single long MCP wait trips coral's transport timeout (-32001).
    const m = await ctx.waitForMention(Math.min(25_000, Math.max(500, deadline - Date.now())))
        if (!m) continue
        const b = parseBid(m.text)
        if (b && b.round === round) bids.push(b)
      }
      const pool = selectBids(bids, round)
      if (pool.length === 0) { console.error(`[buyer] round ${round}: NO_SELLERS`); await sleep(CYCLE_MS); continue }

      // -- award the best value ----------------------------------------------
      const { winner, reason } = await pickWinner(pool, scopeLabels)
      log.event('award', { round, to: winner.by, priceSol: winner.priceSol, reason })
      await ctx.send(formatAward(round, winner.by, reason), thread, [winner.by])

      // -- issue the signed, scoped authorization and hand it to the winner --
      const scope: Scope = Scope.parse({
        categories: categories as TestCategory[],
        exclusions: SCOPE_EXCLUSIONS,
        maxDepth: SCOPE_DEPTH,
      })
      const signed = issueAuthorization({
        signer: buyer, target: TARGET, scope, method: 'well-known',
        nonce: NONCE || 'unpublished', correlationId, ttlSeconds: AUTHZ_TTL_SECS, nowMs: Date.now(),
      })
      log.event('authorization', { round, hash: signed.authzHash, scope: scopeLabels, note: 'granted to seller' })
      await ctx.send(formatAuthzGrant(round, encodeGrant(signed)), thread, [winner.by])

      // -- settle through escrow: deposit -> DEPOSITED -> wait DELIVERED -> release
      const terms = await waitFor<EscrowTerms>(ctx, round, parseEscrowRequired, 15_000)
      if (!terms) { console.error(`[buyer] round ${round}: no escrow terms (seller may have rejected consent)`); await sleep(CYCLE_MS); continue }
      if (!payoutMatches(terms.seller, EXPECTED_SELLER_WALLET)) {
        console.error(`[buyer] round ${round}: escrow payout ${terms.seller} != expected ${EXPECTED_SELLER_WALLET} — skipping`)
        await sleep(CYCLE_MS); continue
      }
      // On-chain binding: the reference MUST derive from OUR authorization hash for THIS round.
      const expectedRef = deriveEscrowReference(signed.authzHash, round).toBase58()
      if (terms.reference !== expectedRef) {
        console.error(`[buyer] round ${round}: escrow reference not bound to authorization (${terms.reference} != ${expectedRef}) — refusing to deposit`)
        await sleep(CYCLE_MS); continue
      }

      const reference = new PublicKey(terms.reference)
      const seller = new PublicKey(terms.seller)
      const requestedSettlement = terms.settlement ?? (SETTLEMENT_MODE === 'direct' ? 'direct' : 'arbiter')
      let depositSig: string
      let vault: PublicKey | undefined
      if (requestedSettlement === 'arbiter') {
        if (!arbiter) throw new Error('ARBITER_KEYPAIR_B58 is required for SETTLEMENT_MODE=arbiter')
        const opened = await openArbitrated(makeArbiter(buyer, RPC), buyer, seller, reference, terms.amountSol, terms.deadlineSecs)
        depositSig = opened.sig; vault = opened.vault
      } else {
        depositSig = await deposit(program, buyer, seller, reference, terms.amountSol, terms.deadlineSecs)
      }
      log.event('deposited', { round, amountSol: terms.amountSol, to: winner.by, sig: depositSig, explorer: expl('tx', depositSig) })
      if (trace) {
        if (requestedSettlement === 'arbiter' && vault) {
          console.error(`[buyer]   arbiter: ${expl('address', ARBITER_PROGRAM_ID.toBase58())}`)
          console.error(`[buyer]   escrow PDA: ${expl('address', arbitratedEscrowPda(vault, reference).toBase58())}`)
        } else {
          console.error(`[buyer]   escrow PDA: ${expl('address', escrowPda(buyer.publicKey, reference).toBase58())}`)
        }
        console.error(`[buyer]   deposit tx: ${expl('tx', depositSig)}`)
      }
      await ctx.send(
        formatDeposited({
          round, reference: terms.reference, buyer: buyer.publicKey.toBase58(), sig: depositSig,
          settlement: requestedSettlement,
          ...(vault && arbiter ? { vault: vault.toBase58(), arbiter: arbiter.publicKey.toBase58() } : {}),
        }),
        thread, [winner.by],
      )

      // -- wait for the delivered report ------------------------------------
      const delivered = await waitFor(ctx, round, (t) => {
        const r = messageRound(t)
        return verb(t) === 'DELIVERED' && r != null ? { round: r, raw: t } : null
      }, DELIVERED_WAIT_MS)

      if (!delivered) {
        log.event('refunded', { round, note: 'no delivery — funds stay in escrow, refundable after the deadline' }, 'warn')
        await sleep(CYCLE_MS); continue
      }

      // -- THE DECISION TO PAY — the money moment ---------------------------
      const decision = evaluateReport(delivered.raw, correlationId, TARGET)
      log.event('decision-to-pay', {
        round, to: winner.by, pay: decision.pay, reason: decision.reason,
        findings: decision.findings, highestSeverity: decision.highestSeverity,
      })
      console.error(`[buyer] round ${round}: DECISION-TO-PAY → ${decision.pay ? 'PAY' : 'WITHHOLD'} (${decision.reason})`)
      if (!decision.pay) {
        log.event('refunded', { round, note: 'report failed evaluation — withholding release, refund on deadline' }, 'warn')
        await sleep(CYCLE_MS); continue
      }

      const releaseSig = requestedSettlement === 'arbiter' && arbiter
        ? await arbitrateRelease(makeArbiter(arbiter, RPC), arbiter, seller, reference)
        : await release(program, buyer, seller, reference)
      const releaseVerb = requestedSettlement === 'arbiter' ? 'ARBITER_RELEASED' : 'RELEASED'
      log.event('released', { round, to: winner.by, sig: releaseSig, explorer: expl('tx', releaseSig) })
      console.error(`[buyer] round ${round}: ${releaseVerb} to ${winner.by} — ${expl('tx', releaseSig)}`)
      await ctx.send(`${releaseVerb} round=${round} sig=${releaseSig} settlement=${requestedSettlement}`, thread, [winner.by])
    } catch (e) {
      console.error(`[buyer] round error: ${e}`)
    }
    await sleep(CYCLE_MS)
  }
})

/** The buyer's decision-to-pay: is the delivered payload a valid report for THIS deal? */
function evaluateReport(
  deliveredText: string,
  correlationId: string,
  target: string,
): { pay: boolean; reason: string; findings: number; highestSeverity: string } {
  const raw = deliveredText.replace(/^DELIVERED\s+round=\d+\s+/, '')
  const parsed = safeParseReport(raw)
  if (!parsed.ok) return { pay: false, reason: `deliverable is not a valid report: ${parsed.error}`, findings: 0, highestSeverity: 'n/a' }
  const r = parsed.report
  if (r.correlationId !== correlationId) return { pay: false, reason: 'report correlation id does not match this deal', findings: r.findings.length, highestSeverity: r.summary.highestSeverity }
  if (r.target !== target) return { pay: false, reason: 'report target does not match the authorized target', findings: r.findings.length, highestSeverity: r.summary.highestSeverity }
  // A valid, on-target, correctly-bound report is the paid deliverable — pay for it (even a clean scan).
  return {
    pay: true,
    reason: `valid report for the authorized target — ${r.summary.totalFindings} findings, highest ${r.summary.highestSeverity}`,
    findings: r.summary.totalFindings,
    highestSeverity: r.summary.highestSeverity,
  }
}
