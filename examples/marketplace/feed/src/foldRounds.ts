/**
 * foldRounds — turn a CoralOS session transcript into typed market Round objects.
 *
 * Pure and network-free, so it's fully unit-testable. Reuses the SAME parsers the agents use
 * (`@pay/agent-runtime`) — the market wire protocol has one source of truth.
 */
import {
  verb, messageRound, parseWant, parseBid, parseAward, parseEscrowRequired, parseDeposited,
} from '@pay/agent-runtime'
import { parseAuthzResult, parseDeliveryProgress } from '@auditmesh/shared'

export interface RawMessage {
  sender: string
  text: string
}

export interface RoundBid {
  by: string
  priceSol: number
  note?: string
}

export type RoundStatus = 'bidding' | 'awarded' | 'deposited' | 'delivered' | 'settled' | 'refunded'

/** The on-chain-enforced consent verdict (AUTHZ_RESULT). Drives the authorization badge. */
export interface RoundAuthz {
  /** sha256 of the signed authorization payload — the value bound to the escrow reference. */
  hash: string
  status: 'verified' | 'rejected'
  /** Machine reason when rejected (e.g. TARGET_NOT_ALLOWLISTED). */
  code?: string
  detail?: string
}

/** One specialist sub-agent's progress within delivery (recon → analysis → reporting). */
export interface RoundDeliveryStage {
  stage: 'recon' | 'analysis' | 'reporting'
  status: 'active' | 'done' | 'error'
  note?: string
  pct?: number
}

/** The seller's delivery graph, folded from a stream of DELIVERY_PROGRESS events (latest per stage). */
export interface RoundDelivery {
  stages: RoundDeliveryStage[]
}

export interface Round {
  round: number
  want?: { service: string; arg: string; budgetSol: number; surface?: { pages: number; forms: number; endpoints: number; params?: number } }
  bids: RoundBid[]
  /** Sellers that were in the market but didn't bid (self-selected out) — needs the seller roster. */
  declined: string[]
  award?: { to: string; reason?: string }
  /** On-chain-enforced consent verdict (AuditMesh). Absent for non-audit (e.g. txodds) rounds. */
  authz?: RoundAuthz
  escrow?: { reference: string; seller: string; amountSol: number; deadlineSecs: number }
  deposit?: { sig: string; buyer: string }
  /** The seller's specialist sub-agents lighting up during delivery (AuditMesh). */
  delivery?: RoundDelivery
  delivered?: { raw: string; data?: unknown }
  release?: { sig: string }
  refunded?: boolean
  status: RoundStatus
}

const tryJson = (s: string): unknown => {
  try { return JSON.parse(s) } catch { return undefined }
}

/** Optional `reason="…"` carried on an AWARD (the buyer's best-value justification). */
const awardReason = (text: string): string | undefined => text.match(/reason="([^"]*)"/)?.[1]

/**
 * Fold raw transcript messages into rounds (ascending). Pass the seller roster to compute which
 * sellers declined a round (self-selection) once its bidding has closed.
 */
export function foldRounds(messages: RawMessage[], sellers: string[] = []): Round[] {
  const byRound = new Map<number, Round>()
  const get = (r: number): Round => {
    let round = byRound.get(r)
    if (!round) {
      round = { round: r, bids: [], declined: [], status: 'bidding' }
      byRound.set(r, round)
    }
    return round
  }

  for (const m of messages) {
    const text = m.text.trim()

    const want = parseWant(text)
    if (want) { get(want.round).want = { service: want.service, arg: want.arg, budgetSol: want.budgetSol, ...(want.surface ? { surface: want.surface } : {}) }; continue }

    const bid = parseBid(text)
    if (bid) {
      const r = get(bid.round)
      if (!r.bids.some((b) => b.by === bid.by)) r.bids.push({ by: bid.by, priceSol: bid.priceSol, note: bid.note })
      continue
    }

    const award = parseAward(text)
    if (award) { const r = get(award.round); r.award = { to: award.to, reason: awardReason(text) }; if (r.status === 'bidding') r.status = 'awarded'; continue }

    const esc = parseEscrowRequired(text)
    if (esc) { get(esc.round).escrow = { reference: esc.reference, seller: esc.seller, amountSol: esc.amountSol, deadlineSecs: esc.deadlineSecs }; continue }

    const dep = parseDeposited(text)
    if (dep) { const r = get(dep.round); r.deposit = { sig: dep.sig, buyer: dep.buyer }; if (r.status !== 'settled') r.status = 'deposited'; continue }

    // AuditMesh: the on-chain-enforced consent verdict (drives the authorization badge).
    const authz = parseAuthzResult(text)
    if (authz) {
      const r = get(authz.round)
      r.authz = {
        hash: authz.hash,
        status: authz.status,
        ...(authz.code ? { code: authz.code } : {}),
        ...(authz.detail ? { detail: authz.detail } : {}),
      }
      continue
    }

    // AuditMesh: a specialist sub-agent's progress. Upsert by stage name; the last status wins.
    const prog = parseDeliveryProgress(text)
    if (prog) {
      const r = get(prog.round)
      if (!r.delivery) r.delivery = { stages: [] }
      const existing = r.delivery.stages.find((s) => s.stage === prog.stage)
      if (existing) {
        existing.status = prog.status
        if (prog.note !== undefined) existing.note = prog.note
        if (prog.pct !== undefined) existing.pct = prog.pct
      } else {
        r.delivery.stages.push({
          stage: prog.stage,
          status: prog.status,
          ...(prog.note !== undefined ? { note: prog.note } : {}),
          ...(prog.pct !== undefined ? { pct: prog.pct } : {}),
        })
      }
      continue
    }

    const v = verb(text)
    const r = messageRound(text)
    if (v === 'DELIVERED' && r != null) {
      const round = get(r)
      const raw = text.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim()
      round.delivered = { raw, data: tryJson(raw) }
      if (round.status !== 'settled') round.status = 'delivered'
    } else if (v === 'RELEASED' && r != null) {
      const round = get(r)
      const sig = text.match(/sig=(\S+)/)?.[1]
      if (sig) round.release = { sig }
      round.status = 'settled'
    } else if (v === 'REFUNDED' && r != null) {
      const round = get(r)
      round.refunded = true
      round.status = 'refunded'
    }
  }

  const rounds = [...byRound.values()].sort((a, b) => a.round - b.round)
  // Sellers who were in the roster but didn't bid on a round whose bidding has closed.
  for (const round of rounds) {
    if (round.status === 'bidding') continue
    round.declined = sellers.filter((s) => !round.bids.some((b) => b.by === s))
  }
  return rounds
}
