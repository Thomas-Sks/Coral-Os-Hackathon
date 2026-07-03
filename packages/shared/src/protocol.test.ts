import { describe, it, expect } from 'vitest'
import {
  formatDeliveryProgress,
  parseDeliveryProgress,
  formatAuthzResult,
  parseAuthzResult,
  formatAuthzGrant,
  parseAuthzGrant,
  type DeliveryProgressEvent,
} from './protocol.js'

describe('DELIVERY_PROGRESS round-trip', () => {
  it('round-trips a full event', () => {
    const ev: DeliveryProgressEvent = {
      round: 3,
      stage: 'recon',
      status: 'active',
      pct: 40,
      note: 'enumerating routes',
    }
    const parsed = parseDeliveryProgress(formatDeliveryProgress(ev))
    expect(parsed).toEqual(ev)
  })

  it('round-trips a minimal event (no pct/note)', () => {
    const ev: DeliveryProgressEvent = { round: 1, stage: 'reporting', status: 'done' }
    expect(parseDeliveryProgress(formatDeliveryProgress(ev))).toEqual(ev)
  })

  it('sanitizes whitespace in the note so the wire format stays parseable', () => {
    const wire = formatDeliveryProgress({
      round: 2,
      stage: 'analysis',
      status: 'active',
      note: 'line one\n  line two',
    })
    const parsed = parseDeliveryProgress(wire)
    expect(parsed?.note).toBe('line one line two')
    expect(parsed?.stage).toBe('analysis')
  })

  it('returns null for a foreign message', () => {
    expect(parseDeliveryProgress('BID round=1 price=0.01 by=x')).toBeNull()
  })
})

describe('AUTHZ_RESULT round-trip', () => {
  it('round-trips a verified verdict', () => {
    const wire = formatAuthzResult({ round: 5, hash: 'a'.repeat(64), status: 'verified' })
    expect(parseAuthzResult(wire)).toEqual({ round: 5, hash: 'a'.repeat(64), status: 'verified' })
  })

  it('round-trips a rejection with code + detail', () => {
    const r = {
      round: 6,
      hash: 'b'.repeat(64),
      status: 'rejected' as const,
      code: 'SCOPE_EXCEEDS_POLICY' as const,
      detail: 'depth 5 exceeds policy max 3',
    }
    expect(parseAuthzResult(formatAuthzResult(r))).toEqual(r)
  })
})

describe('AUTHZ_GRANT round-trip', () => {
  it('carries an opaque token', () => {
    const wire = formatAuthzGrant(9, 'eyJ0b2tlbiI6dHJ1ZX0')
    expect(parseAuthzGrant(wire)).toEqual({ round: 9, token: 'eyJ0b2tlbiI6dHJ1ZX0' })
  })

  it('returns null when the token is missing', () => {
    expect(parseAuthzGrant('AUTHZ_GRANT round=9')).toBeNull()
  })
})
