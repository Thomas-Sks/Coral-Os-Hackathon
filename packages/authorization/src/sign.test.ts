import { describe, it, expect } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { AuthorizationPayload } from '@auditmesh/shared'
import { signAuthorization, verifySignature } from './sign.js'
import { authorizationHash, deriveEscrowReference } from './hash.js'

const NOW = Date.parse('2026-07-02T12:00:00.000Z')

function payload(buyerPubkey: string) {
  return AuthorizationPayload.parse({
    correlationId: 'deal-1',
    target: 'http://localhost:8899',
    buyerPubkey,
    ownershipProof: {
      method: 'well-known',
      nonce: 'deadbeefdeadbeef',
      evidence: 'http://localhost:8899/.well-known/auditmesh-authz.txt',
    },
    scope: { categories: ['security-headers'] },
    issuedAt: new Date(NOW).toISOString(),
    validUntil: new Date(NOW + 3600_000).toISOString(),
    nonce: 'deadbeefdeadbeef',
  })
}

describe('sign / verify', () => {
  it('produces a verifiable signature and stable hash', () => {
    const kp = Keypair.generate()
    const signed = signAuthorization(payload(kp.publicKey.toBase58()), kp)
    expect(verifySignature(signed)).toEqual({ ok: true })
    expect(signed.authzHash).toBe(authorizationHash(signed.payload))
    expect(signed.authzHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('refuses to sign when the signer != payload.buyerPubkey', () => {
    const kp = Keypair.generate()
    const other = Keypair.generate()
    expect(() => signAuthorization(payload(other.publicKey.toBase58()), kp)).toThrow(/does not match/)
  })

  it('detects a tampered payload as HASH_MISMATCH', () => {
    const kp = Keypair.generate()
    const signed = signAuthorization(payload(kp.publicKey.toBase58()), kp)
    const tampered = {
      ...signed,
      payload: { ...signed.payload, target: 'http://juice-shop:3000' },
    }
    const res = verifySignature(tampered)
    expect(res).toMatchObject({ ok: false, code: 'HASH_MISMATCH' })
  })

  it('detects a corrupted signature as BAD_SIGNATURE (hash re-synced)', () => {
    const kp = Keypair.generate()
    const signed = signAuthorization(payload(kp.publicKey.toBase58()), kp)
    // Flip the signature but keep authzHash consistent with the (unchanged) payload.
    const badSig = { ...signed, signatureB58: '1111111111111111111111111111111111111111111111111111111111111111' }
    const res = verifySignature(badSig)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(['BAD_SIGNATURE', 'MALFORMED']).toContain(res.code)
  })
})

describe('deriveEscrowReference — on-chain binding', () => {
  it('is deterministic for a given (hash, round) and differs across rounds', () => {
    const kp = Keypair.generate()
    const signed = signAuthorization(payload(kp.publicKey.toBase58()), kp)
    const r1a = deriveEscrowReference(signed.authzHash, 1)
    const r1b = deriveEscrowReference(signed.authzHash, 1)
    const r2 = deriveEscrowReference(signed.authzHash, 2)
    expect(r1a.toBase58()).toBe(r1b.toBase58())
    expect(r1a.toBase58()).not.toBe(r2.toBase58())
  })
})
