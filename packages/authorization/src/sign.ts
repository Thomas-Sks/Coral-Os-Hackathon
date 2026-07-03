/**
 * Signing + signature verification.
 *
 * The buyer signs the canonical authorization JSON with its Solana keypair (Ed25519 — the same
 * curve Solana uses for transactions). The signature and the content hash travel together as a
 * {@link SignedAuthorization}. Verification is pure/offline: it recomputes the hash and checks the
 * detached signature against the payload's declared `buyerPubkey`. The *live* domain-control recheck
 * and policy checks live in the verifier; this module only proves "the buyer signed exactly this."
 */

import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { Keypair, PublicKey } from '@solana/web3.js'
import {
  canonicalAuthzJson,
  AuthorizationPayload,
  type SignedAuthorization,
} from '@auditmesh/shared'
import { authorizationHash } from './hash.js'

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

/**
 * Sign a payload, producing the detached signature + content hash. Validates the payload against
 * the schema first, and asserts the signing keypair matches the payload's declared `buyerPubkey`
 * so a grant can never claim to be from a key that didn't sign it.
 */
export function signAuthorization(
  payload: AuthorizationPayload,
  signer: Keypair,
): SignedAuthorization {
  const parsed = AuthorizationPayload.parse(payload)
  const signerPubkey = signer.publicKey.toBase58()
  if (parsed.buyerPubkey !== signerPubkey) {
    throw new Error(
      `signer ${signerPubkey} does not match payload.buyerPubkey ${parsed.buyerPubkey}`,
    )
  }
  const canonical = canonicalAuthzJson(parsed)
  const signature = nacl.sign.detached(utf8(canonical), signer.secretKey)
  return {
    payload: parsed,
    signatureB58: bs58.encode(signature),
    authzHash: authorizationHash(parsed),
  }
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; code: 'HASH_MISMATCH' | 'BAD_SIGNATURE' | 'MALFORMED'; reason: string }

/**
 * Offline check that (a) the declared hash matches the canonical payload and (b) the signature is a
 * valid Ed25519 signature over that canonical payload by `buyerPubkey`. Total — never throws.
 */
export function verifySignature(signed: SignedAuthorization): SignatureCheck {
  let payload: AuthorizationPayload
  try {
    payload = AuthorizationPayload.parse(signed.payload)
  } catch (err) {
    return { ok: false, code: 'MALFORMED', reason: `payload failed schema: ${errText(err)}` }
  }

  const canonical = canonicalAuthzJson(payload)
  const expectedHash = authorizationHash(payload)
  if (expectedHash !== signed.authzHash) {
    return {
      ok: false,
      code: 'HASH_MISMATCH',
      reason: `authzHash ${signed.authzHash} != sha256(payload) ${expectedHash}`,
    }
  }

  let pubkeyBytes: Uint8Array
  let sigBytes: Uint8Array
  try {
    pubkeyBytes = new PublicKey(payload.buyerPubkey).toBytes()
    sigBytes = bs58.decode(signed.signatureB58)
  } catch (err) {
    return { ok: false, code: 'MALFORMED', reason: `bad pubkey/signature encoding: ${errText(err)}` }
  }

  const valid = nacl.sign.detached.verify(utf8(canonical), sigBytes, pubkeyBytes)
  return valid
    ? { ok: true }
    : { ok: false, code: 'BAD_SIGNATURE', reason: 'signature does not verify against buyerPubkey' }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
