import { describe, it, expect } from 'vitest'
import { Keypair } from '@solana/web3.js'
import { AuthorizationPayload } from '@auditmesh/shared'
import { signAuthorization } from './sign.js'
import { encodeGrant, decodeGrant } from './grant.js'

const NOW = Date.parse('2026-07-02T12:00:00.000Z')

function signedGrant() {
  const kp = Keypair.generate()
  const payload = AuthorizationPayload.parse({
    correlationId: 'deal-1',
    target: 'http://localhost:8899',
    buyerPubkey: kp.publicKey.toBase58(),
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
  return signAuthorization(payload, kp)
}

describe('grant transport', () => {
  it('round-trips a signed grant through a whitespace-free token', () => {
    const signed = signedGrant()
    const token = encodeGrant(signed)
    expect(token).not.toMatch(/\s/)
    const res = decodeGrant(token)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.signed).toEqual(signed)
  })

  it('rejects a non-base64url / non-JSON token gracefully', () => {
    expect(decodeGrant('!!!not base64!!!').ok).toBe(false)
    expect(decodeGrant(Buffer.from('not json', 'utf8').toString('base64url')).ok).toBe(false)
  })

  it('rejects a token whose decoded object fails the schema', () => {
    const bad = Buffer.from(JSON.stringify({ nope: true }), 'utf8').toString('base64url')
    expect(decodeGrant(bad).ok).toBe(false)
  })
})
