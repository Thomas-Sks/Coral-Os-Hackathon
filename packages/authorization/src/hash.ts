/**
 * Content hashing + the on-chain binding.
 *
 * The authorization hash is the sha256 of the canonical payload JSON. It is what the escrow
 * `reference` is derived from, so the on-chain deal provably references *this exact* signed grant —
 * "was this work authorized?" becomes a question the chain answers at settlement, not a matter of
 * trust between the two agents.
 */

import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import { canonicalAuthzJson, type AuthorizationPayload } from '@auditmesh/shared'

/** Lowercase hex sha256 of an arbitrary string. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/** The authorization hash bound to the escrow reference: sha256 of the canonical payload. */
export function authorizationHash(payload: AuthorizationPayload): string {
  return sha256Hex(canonicalAuthzJson(payload))
}

/**
 * Derive the escrow reference from the authorization hash + round. A Solana `reference` is just a
 * 32-byte seed (need not lie on the ed25519 curve), so we hash to 32 bytes and wrap it directly —
 * exactly the pattern the starter uses to bind a reference to its delivery. Deterministic: the
 * buyer (to deposit) and the seller (to verify the funded escrow) derive the identical value.
 */
export function deriveEscrowReference(authzHash: string, round: number): PublicKey {
  const digest = createHash('sha256').update(`auditmesh:${round}:${authzHash}`, 'utf8').digest()
  return new PublicKey(digest)
}
