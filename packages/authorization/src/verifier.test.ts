import { describe, it, expect } from 'vitest'
import { Keypair } from '@solana/web3.js'
import type { ScopePolicy, SignedAuthorization } from '@auditmesh/shared'
import { issueAuthorization } from './issue.js'
import { wellKnownBody } from './challenge.js'
import { verifyAuthorization } from './verifier.js'

const NOW = Date.parse('2026-07-02T12:00:00.000Z')
const TARGET = 'http://localhost:8899'

/** A domain-control network stub that serves the well-known token for a known nonce. */
const servingNonce =
  (nonce: string) =>
  async (url: string): Promise<string> => {
    if (url.endsWith('/.well-known/auditmesh-authz.txt')) return wellKnownBody(nonce)
    throw new Error(`unexpected fetch ${url}`)
  }

function buildGrant(over: Partial<Parameters<typeof issueAuthorization>[0]> = {}): {
  signed: SignedAuthorization
  nonce: string
} {
  const signer = Keypair.generate()
  const nonce = 'a1b2c3d4e5f6a7b8'
  const signed = issueAuthorization({
    signer,
    target: TARGET,
    scope: { categories: ['security-headers', 'tls-config'] } as never,
    method: 'well-known',
    nonce,
    correlationId: 'deal-xyz',
    ttlSeconds: 3600,
    nowMs: NOW,
    ...over,
  })
  return { signed, nonce }
}

describe('verifyAuthorization — the enforced gate', () => {
  it('accepts a valid, live, in-policy grant', async () => {
    const { signed, nonce } = buildGrant()
    const verdict = await verifyAuthorization(signed, {
      nowMs: NOW,
      domainControl: { fetchText: servingNonce(nonce) },
    })
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.authzHash).toBe(signed.authzHash)
      expect(verdict.target).toBe(TARGET)
    }
  })

  it('rejects an EXPIRED grant', async () => {
    const { signed, nonce } = buildGrant({ ttlSeconds: 60 })
    const verdict = await verifyAuthorization(signed, {
      nowMs: NOW + 120_000, // two minutes later
      domainControl: { fetchText: servingNonce(nonce) },
    })
    expect(verdict).toMatchObject({ ok: false, code: 'EXPIRED' })
  })

  it('rejects a NOT_YET_VALID grant issued in the future', async () => {
    const { signed, nonce } = buildGrant({ nowMs: NOW + 3_600_000 })
    const verdict = await verifyAuthorization(signed, {
      nowMs: NOW,
      domainControl: { fetchText: servingNonce(nonce) },
    })
    expect(verdict).toMatchObject({ ok: false, code: 'NOT_YET_VALID' })
  })

  it('rejects a wrong / non-allowlisted TARGET', async () => {
    const { signed, nonce } = buildGrant({ target: 'http://evil.example.com' })
    const verdict = await verifyAuthorization(signed, {
      nowMs: NOW,
      domainControl: { fetchText: servingNonce(nonce) },
    })
    expect(verdict).toMatchObject({ ok: false, code: 'TARGET_NOT_ALLOWLISTED' })
  })

  it('rejects an OUT-OF-SCOPE grant that exceeds policy', async () => {
    const { signed, nonce } = buildGrant({
      scope: { categories: ['injection'], maxDepth: 5 } as never,
    })
    const strictPolicy: ScopePolicy = {
      allowedCategories: ['security-headers', 'tls-config'],
      maxDepth: 2,
      maxDurationSeconds: 900,
      requireNonDestructive: true,
    }
    const verdict = await verifyAuthorization(signed, {
      nowMs: NOW,
      policy: strictPolicy,
      domainControl: { fetchText: servingNonce(nonce) },
    })
    expect(verdict).toMatchObject({ ok: false, code: 'SCOPE_EXCEEDS_POLICY' })
    if (!verdict.ok) expect(verdict.reason).toMatch(/injection|depth/)
  })

  it('rejects when live domain-control fails (token removed)', async () => {
    const { signed } = buildGrant()
    const verdict = await verifyAuthorization(signed, {
      nowMs: NOW,
      domainControl: { fetchText: async () => 'nothing here' },
    })
    expect(verdict).toMatchObject({ ok: false, code: 'DOMAIN_CONTROL_UNVERIFIED' })
  })

  it('rejects a grant with a tampered scope (broken signature)', async () => {
    const { signed, nonce } = buildGrant()
    const tampered: SignedAuthorization = {
      ...signed,
      payload: {
        ...signed.payload,
        scope: { ...signed.payload.scope, maxDepth: 5, categories: ['injection'] },
      },
    }
    const verdict = await verifyAuthorization(tampered, {
      nowMs: NOW,
      domainControl: { fetchText: servingNonce(nonce) },
    })
    // Hash still matches the original payload but no longer the tampered one → HASH_MISMATCH.
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(['HASH_MISMATCH', 'BAD_SIGNATURE']).toContain(verdict.code)
  })
})
