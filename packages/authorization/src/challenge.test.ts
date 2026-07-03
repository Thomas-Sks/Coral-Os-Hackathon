import { describe, it, expect } from 'vitest'
import { OwnershipProof } from '@auditmesh/shared'
import {
  generateNonce,
  wellKnownUrl,
  wellKnownBody,
  buildOwnershipProof,
  verifyDomainControl,
} from './challenge.js'

const TARGET = 'http://localhost:8899'

describe('challenge helpers', () => {
  it('generates unguessable, unique nonces', () => {
    const a = generateNonce()
    const b = generateNonce()
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('derives the well-known URL and matching body', () => {
    expect(wellKnownUrl(TARGET)).toBe('http://localhost:8899/.well-known/auditmesh-authz.txt')
    expect(wellKnownBody('abc')).toBe('auditmesh-authz=abc\n')
  })

  it('builds a schema-valid ownership proof', () => {
    const proof = buildOwnershipProof('well-known', generateNonce(), TARGET)
    expect(() => OwnershipProof.parse(proof)).not.toThrow()
    expect(proof.evidence).toContain('.well-known')
  })
})

describe('verifyDomainControl — well-known', () => {
  const nonce = generateNonce()
  const proof = buildOwnershipProof('well-known', nonce, TARGET)

  it('passes when the live token contains the nonce', async () => {
    const res = await verifyDomainControl(proof, TARGET, {
      fetchText: async () => wellKnownBody(nonce),
    })
    expect(res).toEqual({ ok: true })
  })

  it('fails when the token is absent or wrong', async () => {
    const res = await verifyDomainControl(proof, TARGET, { fetchText: async () => 'no token' })
    expect(res.ok).toBe(false)
  })

  it('fails (not throws) when the fetch errors', async () => {
    const res = await verifyDomainControl(proof, TARGET, {
      fetchText: async () => {
        throw new Error('ECONNREFUSED')
      },
    })
    expect(res).toMatchObject({ ok: false })
  })
})

describe('verifyDomainControl — dns-txt', () => {
  const nonce = generateNonce()
  const proof = buildOwnershipProof('dns-txt', nonce, TARGET)

  it('passes when a TXT record matches auditmesh-authz=<nonce>', async () => {
    const res = await verifyDomainControl(proof, TARGET, {
      resolveTxt: async () => [['unrelated=1'], [`auditmesh-authz=${nonce}`]],
    })
    expect(res).toEqual({ ok: true })
  })

  it('fails when no TXT record matches', async () => {
    const res = await verifyDomainControl(proof, TARGET, {
      resolveTxt: async () => [['auditmesh-authz=other']],
    })
    expect(res.ok).toBe(false)
  })
})
