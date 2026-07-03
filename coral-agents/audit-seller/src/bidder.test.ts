import { describe, it, expect } from 'vitest'
import type { Want } from '@pay/agent-runtime'
import { AUDIT_SERVICE } from '@auditmesh/shared'
import { decideBid, sellerConfigFromEnv, type SellerConfig } from './bidder.js'

const want = (over: Partial<Want> = {}): Want => ({
  round: 1,
  service: AUDIT_SERVICE,
  arg: 'hdr+tls',
  budgetSol: 0.02,
  ...over,
})

const cfg = (over: Partial<SellerConfig> = {}): SellerConfig => ({
  name: 'audit-x',
  floorSol: 0.004,
  offeredCategories: ['security-headers', 'tls-config'],
  strategy: 'premium',
  persona: 'test persona',
  ...over,
})

/** A fake LLM returning a fixed JSON proposal. */
const fakeLlm = (bid: boolean, price: number, note = 'ok') => async () =>
  JSON.stringify({ bid, price, note })
const brokenLlm = async () => {
  throw new Error('no network')
}

describe('decideBid — hard guards (no LLM call)', () => {
  it('refuses a non-audit service', async () => {
    const d = await decideBid(want({ service: 'txline' }), cfg(), fakeLlm(true, 0.01))
    expect(d.bid).toBe(false)
    expect(d.note).toMatch(/inventory/)
  })

  it('refuses when the cost floor exceeds the budget', async () => {
    const d = await decideBid(want({ budgetSol: 0.001 }), cfg({ floorSol: 0.01 }), fakeLlm(true, 0.01))
    expect(d.bid).toBe(false)
    expect(d.note).toMatch(/below floor/)
  })

  it('a specialist declines a job outside its specialty', async () => {
    const d = await decideBid(
      want({ arg: 'hdr+tls+xss' }),
      cfg({ strategy: 'specialist', offeredCategories: ['security-headers', 'tls-config'] }),
      fakeLlm(true, 0.01),
    )
    expect(d.bid).toBe(false)
    expect(d.note).toMatch(/specialty/)
  })

  it('a specialist bids when the whole job is in its lane', async () => {
    const d = await decideBid(
      want({ arg: 'hdr+tls' }),
      cfg({ strategy: 'specialist' }),
      fakeLlm(true, 0.009),
    )
    expect(d.bid).toBe(true)
  })
})

describe('decideBid — price enforcement (model proposes, code disposes)', () => {
  it('clamps a below-floor proposal up to the floor', async () => {
    const d = await decideBid(want(), cfg({ floorSol: 0.004 }), fakeLlm(true, 0.0001))
    expect(d.bid).toBe(true)
    expect(d.priceSol).toBeGreaterThanOrEqual(0.004)
  })

  it('clamps an over-budget proposal down to the budget', async () => {
    const d = await decideBid(want({ budgetSol: 0.02 }), cfg(), fakeLlm(true, 999))
    expect(d.priceSol).toBeLessThanOrEqual(0.02)
  })

  it('honors an explicit LLM decline', async () => {
    const d = await decideBid(want(), cfg(), fakeLlm(false, 0))
    expect(d.bid).toBe(false)
  })

  it('falls back to a strategy-anchored in-bounds price when the LLM is unavailable', async () => {
    const discount = await decideBid(want(), cfg({ strategy: 'discount', floorSol: 0.002 }), brokenLlm)
    const premium = await decideBid(want(), cfg({ strategy: 'premium', floorSol: 0.002 }), brokenLlm)
    expect(discount.bid && premium.bid).toBe(true)
    expect(discount.priceSol).toBeGreaterThanOrEqual(0.002)
    expect(premium.priceSol).toBeLessThanOrEqual(0.02)
    // premium prices above discount for the same budget/floor
    expect(premium.priceSol).toBeGreaterThan(discount.priceSol)
  })
})

describe('sellerConfigFromEnv', () => {
  it('reads strategy, floor, and offered categories from env (short codes)', () => {
    const prev = { ...process.env }
    process.env.STRATEGY = 'discount'
    process.env.FLOOR_SOL = '0.003'
    process.env.OFFERED_CATEGORIES = 'hdr,tls'
    const c = sellerConfigFromEnv('audit-discounter')
    expect(c.strategy).toBe('discount')
    expect(c.floorSol).toBeCloseTo(0.003)
    expect(c.offeredCategories.sort()).toEqual(['security-headers', 'tls-config'])
    process.env = prev
  })

  it('defaults to all categories when OFFERED_CATEGORIES is empty', () => {
    const prev = { ...process.env }
    delete process.env.OFFERED_CATEGORIES
    process.env.STRATEGY = 'premium'
    const c = sellerConfigFromEnv('audit-premium')
    expect(c.offeredCategories.length).toBeGreaterThan(5)
    process.env = prev
  })
})
