/**
 * The verifier — the enforced consent gate.
 *
 * Used by BOTH the seller (before it runs any assessment) and the on-chain arbiter path (before it
 * lets an escrow release). It answers one question — "is this exact grant valid, live, and in
 * policy, right now?" — by running every check and returning a single {@link AuthzVerdict}. Any
 * failure is a hard stop with a machine reason; there is deliberately no "force" or "skip" path.
 *
 * Check order is cheapest-first so a bad grant is rejected before we spend a network round-trip:
 *   1. signature + content hash   (offline, free)
 *   2. target ∈ allowlist         (offline, free)   ← the scanner's hard boundary
 *   3. time window                (offline, free)
 *   4. scope ≤ policy             (offline, free)
 *   5. live domain-control recheck (network)        ← proves control *now*, not just at issue time
 */

import {
  isAllowlisted,
  checkScopeWithinPolicy,
  DEFAULT_SCOPE_POLICY,
  type ScopePolicy,
  type AuthzVerdict,
  type SignedAuthorization,
} from '@auditmesh/shared'
import { verifySignature } from './sign.js'
import { verifyDomainControl, type DomainControlDeps } from './challenge.js'

export interface VerifyOptions {
  /** Policy ceiling the granted scope must fit within. Defaults to the conservative bundled policy. */
  policy?: ScopePolicy
  /** Current time in ms since epoch. Injected so verification is deterministic in tests. */
  nowMs?: number
  /** Injected network for the live domain-control recheck. */
  domainControl?: DomainControlDeps
}

/**
 * Full verification, including the live domain-control recheck. Total — never throws; every failure
 * mode returns `{ ok: false, code, reason }` matching the dashboard's rejection labels.
 */
export async function verifyAuthorization(
  signed: SignedAuthorization,
  opts: VerifyOptions = {},
): Promise<AuthzVerdict> {
  const policy = opts.policy ?? DEFAULT_SCOPE_POLICY
  const nowMs = opts.nowMs ?? Date.now()

  // 1. signature + hash
  const sig = verifySignature(signed)
  if (!sig.ok) {
    const code = sig.code === 'HASH_MISMATCH' ? 'HASH_MISMATCH' : sig.code === 'MALFORMED' ? 'MALFORMED' : 'BAD_SIGNATURE'
    return { ok: false, code, reason: sig.reason }
  }

  const { payload, authzHash } = signed

  // 2. target allowlist — the hard boundary
  if (!isAllowlisted(payload.target)) {
    return {
      ok: false,
      code: 'TARGET_NOT_ALLOWLISTED',
      reason: `target ${payload.target} is not on the AuditMesh allowlist`,
    }
  }

  // 3. time window
  const validUntil = Date.parse(payload.validUntil)
  const issuedAt = Date.parse(payload.issuedAt)
  if (Number.isFinite(issuedAt) && nowMs < issuedAt) {
    return { ok: false, code: 'NOT_YET_VALID', reason: `grant not valid until ${payload.issuedAt}` }
  }
  if (!Number.isFinite(validUntil) || nowMs > validUntil) {
    return { ok: false, code: 'EXPIRED', reason: `grant expired at ${payload.validUntil}` }
  }

  // 4. scope within policy
  const violations = checkScopeWithinPolicy(payload.scope, policy)
  if (violations.length > 0) {
    return {
      ok: false,
      code: 'SCOPE_EXCEEDS_POLICY',
      reason: violations.map((v) => v.detail).join('; '),
    }
  }

  // 5. live domain-control recheck
  const dc = await verifyDomainControl(payload.ownershipProof, payload.target, opts.domainControl)
  if (!dc.ok) {
    return { ok: false, code: 'DOMAIN_CONTROL_UNVERIFIED', reason: dc.reason }
  }

  return { ok: true, authzHash, target: payload.target, scope: payload.scope }
}
