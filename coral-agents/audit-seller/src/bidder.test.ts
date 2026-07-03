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
  scanMode: 'quick',
  efficiency: 1,
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

describe('decideBid — dynamic cost-based price (COGS = Strix tokens; code disposes)', () => {
  it('never prices below the floor', async () => {
    const d = await decideBid(want({ budgetSol: 0.08 }), cfg({ floorSol: 0.03, scanMode: 'quick' }), fakeLlm(true, 0))
    expect(d.bid).toBe(true)
    expect(d.priceSol).toBeGreaterThanOrEqual(0.03)
  })

  it('never prices above the budget (caps the cost-based price)', async () => {
    const d = await decideBid(want({ budgetSol: 0.02 }), cfg({ strategy: 'premium', scanMode: 'deep' }), fakeLlm(true, 0))
    expect(d.priceSol).toBeLessThanOrEqual(0.02)
  })

  it('honors an explicit LLM decline', async () => {
    const d = await decideBid(want(), cfg(), fakeLlm(false, 0))
    expect(d.bid).toBe(false)
  })

  it('prices deeper scans above shallower ones (depth drives token cost)', async () => {
    const quick = await decideBid(want({ budgetSol: 0.08 }), cfg({ floorSol: 0.001, scanMode: 'quick' }), brokenLlm)
    const deep = await decideBid(want({ budgetSol: 0.08 }), cfg({ floorSol: 0.001, scanMode: 'deep' }), brokenLlm)
    expect(quick.bid && deep.bid).toBe(true)
    expect(deep.priceSol).toBeGreaterThan(quick.priceSol)
  })

  it('scales the price with the target attack surface', async () => {
    const small = await decideBid(want({ budgetSol: 0.5, surface: { pages: 3, forms: 1, endpoints: 2 } }), cfg({ floorSol: 0.001, scanMode: 'deep' }), brokenLlm)
    const big = await decideBid(want({ budgetSol: 0.5, surface: { pages: 200, forms: 40, endpoints: 300 } }), cfg({ floorSol: 0.001, scanMode: 'deep' }), brokenLlm)
    expect(big.priceSol).toBeGreaterThan(small.priceSol)
  })

  it('declines when the scan cost exceeds the budget for that depth', async () => {
    const d = await decideBid(
      want({ budgetSol: 0.001, surface: { pages: 500, forms: 100, endpoints: 500 } }),
      cfg({ floorSol: 0.0001, scanMode: 'deep' }),
      fakeLlm(true, 0),
    )
    expect(d.bid).toBe(false)
    expect(d.note).toMatch(/scan cost/)
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
