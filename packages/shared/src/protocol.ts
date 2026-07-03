/**
 * AuditMesh protocol extensions.
 *
 * The starter's market protocol (`@pay/agent-runtime` — WANT/BID/AWARD/ESCROW_REQUIRED/DEPOSITED)
 * is reused verbatim; nothing here replaces it. AuditMesh adds three additional thread messages that
 * ride the same CoralOS bus and are folded by the marketplace feed, so the dashboard can render the
 * two things the base protocol has no vocabulary for:
 *
 *   AUTHZ_RESULT     — the on-chain-enforced consent verdict (drives the authorization badge)
 *   DELIVERY_PROGRESS — the seller's specialist sub-agents activating (drives the delivery graph)
 *   AUTHZ_GRANT      — the buyer handing the full signed grant to the seller (opaque token)
 *
 * All helpers are pure and browser-safe: format/parse strings only, no crypto, no I/O. The grant
 * token itself is encoded/decoded in `@auditmesh/authorization` (Node-only); here it is opaque.
 */

import { z } from 'zod'
import { AuthzFailureCode } from './authorization.js'

/**
 * The dashboard's deal state machine — the narrative spine WANT → … → RELEASED. Derived from the
 * feed's round status plus the authorization verdict; not a wire message itself. REJECTED and
 * REFUNDED are the two "held up under dispute / no-show" terminal states the demo must show.
 */
export const DEAL_PIPELINE = [
  'WANT',
  'BID',
  'AWARD',
  'AUTHORIZED',
  'DEPOSITED',
  'DELIVERED',
  'RELEASED',
] as const
export type DealState = (typeof DEAL_PIPELINE)[number] | 'REFUNDED' | 'REJECTED'

/** The service name that routes a WANT to the security-assessment seller (cf. txodds' `txline`). */
export const AUDIT_SERVICE = 'audit'

// ─────────────────────────────────────────────────────────────────────────────
// Delivery graph — the seller's specialist sub-agents (recon → analysis → reporting)
// ─────────────────────────────────────────────────────────────────────────────

export const DELIVERY_STAGES = ['recon', 'analysis', 'reporting'] as const
export const DeliveryStage = z.enum(DELIVERY_STAGES)
export type DeliveryStage = z.infer<typeof DeliveryStage>

export const DELIVERY_STAGE_LABEL: Record<DeliveryStage, string> = {
  recon: 'Recon',
  analysis: 'Analysis',
  reporting: 'Reporting',
}

export const DeliveryStatus = z.enum(['active', 'done', 'error'])
export type DeliveryStatus = z.infer<typeof DeliveryStatus>

export interface DeliveryProgressEvent {
  round: number
  stage: DeliveryStage
  status: DeliveryStatus
  /** 0–100 coarse progress within the stage; optional. */
  pct?: number
  /** Short human note streamed under the node (e.g. "12 routes enumerated"). */
  note?: string
}

/** `DELIVERY_PROGRESS round=<n> stage=<s> status=<st> [pct=<n>] [note="..."]` */
export function formatDeliveryProgress(ev: DeliveryProgressEvent): string {
  const parts = [
    'DELIVERY_PROGRESS',
    `round=${ev.round}`,
    `stage=${ev.stage}`,
    `status=${ev.status}`,
  ]
  if (typeof ev.pct === 'number') parts.push(`pct=${Math.round(ev.pct)}`)
  if (ev.note) parts.push(`note=${JSON.stringify(sanitizeInline(ev.note))}`)
  return parts.join(' ')
}

export function parseDeliveryProgress(text: string): DeliveryProgressEvent | null {
  if (!text.startsWith('DELIVERY_PROGRESS')) return null
  const round = intField(text, 'round')
  const stage = DeliveryStage.safeParse(strField(text, 'stage'))
  const status = DeliveryStatus.safeParse(strField(text, 'status'))
  if (round === undefined || !stage.success || !status.success) return null
  const pctRaw = intField(text, 'pct')
  return {
    round,
    stage: stage.data,
    status: status.data,
    ...(pctRaw !== undefined ? { pct: pctRaw } : {}),
    ...(quotedField(text, 'note') ? { note: quotedField(text, 'note') } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorization verdict — the on-chain-enforced consent badge
// ─────────────────────────────────────────────────────────────────────────────

export const AuthzStatus = z.enum(['verified', 'rejected'])
export type AuthzStatus = z.infer<typeof AuthzStatus>

export interface AuthzResult {
  round: number
  /** sha256 of the authorization payload — the value bound to the escrow reference. */
  hash: string
  status: AuthzStatus
  /** Present when rejected: the machine reason. */
  code?: AuthzFailureCode
  detail?: string
}

/** `AUTHZ_RESULT round=<n> hash=<h> status=<verified|rejected> [code=<C>] [detail="..."]` */
export function formatAuthzResult(r: AuthzResult): string {
  const parts = ['AUTHZ_RESULT', `round=${r.round}`, `hash=${r.hash}`, `status=${r.status}`]
  if (r.code) parts.push(`code=${r.code}`)
  if (r.detail) parts.push(`detail=${JSON.stringify(sanitizeInline(r.detail))}`)
  return parts.join(' ')
}

export function parseAuthzResult(text: string): AuthzResult | null {
  if (!text.startsWith('AUTHZ_RESULT')) return null
  const round = intField(text, 'round')
  const hash = strField(text, 'hash')
  const status = AuthzStatus.safeParse(strField(text, 'status'))
  if (round === undefined || !hash || !status.success) return null
  const codeRaw = strField(text, 'code')
  const code = codeRaw ? AuthzFailureCode.safeParse(codeRaw) : undefined
  return {
    round,
    hash,
    status: status.data,
    ...(code && code.success ? { code: code.data } : {}),
    ...(quotedField(text, 'detail') ? { detail: quotedField(text, 'detail') } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorization grant transport — the buyer hands the seller the full signed grant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `AUTHZ_GRANT round=<n> <token>` where `<token>` is an opaque, whitespace-free encoding of the
 * SignedAuthorization (base64url; produced by `@auditmesh/authorization`). Kept opaque here so this
 * module stays crypto-free and browser-safe.
 */
export function formatAuthzGrant(round: number, token: string): string {
  return `AUTHZ_GRANT round=${round} ${token}`
}

export function parseAuthzGrant(text: string): { round: number; token: string } | null {
  const m = text.match(/^AUTHZ_GRANT\s+round=(\d+)\s+(\S+)\s*$/)
  if (!m) return null
  return { round: Number(m[1]), token: m[2] }
}

// ─────────────────────────────────────────────────────────────────────────────
// tiny shared field parsers (mirror the runtime protocol's tolerant regex style)
// ─────────────────────────────────────────────────────────────────────────────

function strField(text: string, key: string): string | undefined {
  return text.match(new RegExp(`(?:^|\\s)${key}=(\\S+)`))?.[1]
}
function intField(text: string, key: string): number | undefined {
  const raw = strField(text, key)
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}
function quotedField(text: string, key: string): string | undefined {
  const m = text.match(new RegExp(`(?:^|\\s)${key}="((?:[^"\\\\]|\\\\.)*)"`))
  if (!m) return undefined
  try {
    return JSON.parse(`"${m[1]}"`)
  } catch {
    return m[1]
  }
}
/** Collapse whitespace so a value never breaks the space-delimited wire format. */
function sanitizeInline(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 240)
}
