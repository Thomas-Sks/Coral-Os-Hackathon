/**
 * Issue a signed, scoped authorization — the buyer's side of consent.
 *
 * Assembles the {@link AuthorizationPayload} from a target, a granted scope, and a domain-control
 * nonce that has ALREADY been published at the target (via the well-known file the front-door serves
 * or a DNS TXT record), then signs it. The result is the grant the buyer deposits against and hands
 * to the seller. Time is injected so issuance is deterministic in tests and demos.
 */

import { Keypair } from '@solana/web3.js'
import {
  AuthorizationPayload,
  type Scope,
  type OwnershipMethod,
  type SignedAuthorization,
} from '@auditmesh/shared'
import { buildOwnershipProof } from './challenge.js'
import { signAuthorization } from './sign.js'

export interface IssueAuthorizationInput {
  signer: Keypair
  /** Allowlisted target origin the grant authorizes. */
  target: string
  /** The scope being granted (must fit within policy — the verifier enforces that). */
  scope: Scope
  /** How domain control was demonstrated. */
  method: OwnershipMethod
  /** The nonce already published at the target. */
  nonce: string
  /** Ties the grant to its deal + report + on-chain reference. */
  correlationId: string
  /** Grant lifetime in seconds from `nowMs`. */
  ttlSeconds: number
  /** Current time (ms since epoch). */
  nowMs: number
}

/** Build and sign a complete authorization. Throws only on programmer error (bad schema/signer). */
export function issueAuthorization(input: IssueAuthorizationInput): SignedAuthorization {
  const issuedAt = new Date(input.nowMs).toISOString()
  const validUntil = new Date(input.nowMs + input.ttlSeconds * 1000).toISOString()

  const payload = AuthorizationPayload.parse({
    schemaVersion: 1,
    correlationId: input.correlationId,
    target: input.target,
    buyerPubkey: input.signer.publicKey.toBase58(),
    ownershipProof: buildOwnershipProof(input.method, input.nonce, input.target),
    scope: input.scope,
    issuedAt,
    validUntil,
    nonce: input.nonce,
  })

  return signAuthorization(payload, input.signer)
}
