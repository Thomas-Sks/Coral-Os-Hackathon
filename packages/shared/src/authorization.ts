/**
 * Authorization payloads — the on-chain-enforced consent layer.
 *
 * Before any assessment runs, the buyer must (1) prove control of the target and (2) sign a
 * *scoped* grant with its Solana keypair. This module defines the wire shapes for both, plus the
 * canonicalization used to hash and sign them. The signing, the live domain-control check, and the
 * policy verification live in `@auditmesh/authorization` (Node-only); the types and the pure
 * canonical serializer live here so the browser dashboard and the agents share one contract.
 *
 * The authorization hash produced here is what the escrow `reference` is bound to, so the question
 * "was this work authorized?" is answered on-chain at settlement, not left to trust.
 */

import { z } from 'zod'
import { Scope } from './scope.js'

/** How domain control was demonstrated. Both prove *control*, not a mere claim. */
export const OwnershipMethod = z.enum(['well-known', 'dns-txt'])
export type OwnershipMethod = z.infer<typeof OwnershipMethod>

/** The `.well-known` path the verifier fetches (relative to the target origin). */
export const WELL_KNOWN_PATH = '/.well-known/auditmesh-authz.txt'
/** The DNS TXT record name the verifier resolves, when the DNS method is used. */
export const DNS_TXT_PREFIX = 'auditmesh-authz='

export const OwnershipProof = z
  .object({
    method: OwnershipMethod,
    /** The random challenge the buyer published at the target (TXT value or well-known body). */
    nonce: z.string().min(8),
    /** Where the token was published — the well-known URL or the TXT record name. Informational. */
    evidence: z.string().min(1),
  })
  .strict()
export type OwnershipProof = z.infer<typeof OwnershipProof>

/**
 * The exact object the buyer signs. Every field is load-bearing:
 *  - `target` pins the host (must be on the allowlist).
 *  - `ownershipProof` ties the grant to a demonstrated control challenge.
 *  - `scope` caps what the seller may do.
 *  - `validUntil` bounds it in time.
 *  - `nonce` makes each authorization unique (and dedupes replays).
 *  - `buyerPubkey` is the signer; the verifier checks the signature against it.
 */
export const AuthorizationPayload = z
  .object({
    schemaVersion: z.literal(1).default(1),
    /** Ties the authorization to its deal + report + on-chain reference. */
    correlationId: z.string().min(1),
    /** The allowlisted target host/origin this grant authorizes work against. */
    target: z.string().min(1),
    /** base58 Solana public key of the granting buyer. */
    buyerPubkey: z.string().min(32),
    ownershipProof: OwnershipProof,
    scope: Scope,
    /** ISO-8601 issue time. */
    issuedAt: z.string().min(1),
    /** ISO-8601 expiry. The verifier rejects the grant after this instant. */
    validUntil: z.string().min(1),
    /** Unique per authorization. */
    nonce: z.string().min(8),
  })
  .strict()
export type AuthorizationPayload = z.infer<typeof AuthorizationPayload>

/** A payload plus its detached Ed25519 signature and content hash. */
export const SignedAuthorization = z
  .object({
    payload: AuthorizationPayload,
    /** base58 Ed25519 signature over {@link canonicalAuthzJson}(payload) by `payload.buyerPubkey`. */
    signatureB58: z.string().min(1),
    /** Lowercase hex sha256 of the canonical payload JSON. Bound to the escrow reference. */
    authzHash: z.string().regex(/^[0-9a-f]{64}$/, 'authzHash must be 64 lowercase hex chars'),
  })
  .strict()
export type SignedAuthorization = z.infer<typeof SignedAuthorization>

/** Machine-readable reasons an authorization can fail — each maps to a dashboard rejection label. */
export const AuthzFailureCode = z.enum([
  'BAD_SIGNATURE',
  'HASH_MISMATCH',
  'TARGET_NOT_ALLOWLISTED',
  'DOMAIN_CONTROL_UNVERIFIED',
  'EXPIRED',
  'NOT_YET_VALID',
  'SCOPE_EXCEEDS_POLICY',
  'MALFORMED',
])
export type AuthzFailureCode = z.infer<typeof AuthzFailureCode>

/** The verifier's verdict. `ok` gates every scan and every escrow release. */
export type AuthzVerdict =
  | { ok: true; authzHash: string; target: string; scope: Scope }
  | { ok: false; code: AuthzFailureCode; reason: string }

/**
 * Deterministically serialize a payload for hashing/signing. Recursively sorts object keys so the
 * bytes are identical regardless of property insertion order on either side of the wire. Pure and
 * browser-safe (no node:crypto) — the hash itself is computed in `@auditmesh/authorization`.
 */
export function canonicalAuthzJson(payload: AuthorizationPayload): string {
  return stableStringify(AuthorizationPayload.parse(payload))
}

/** Recursive key-sorted JSON.stringify. Handles the plain JSON subset our payloads use. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  return `{${entries.join(',')}}`
}
