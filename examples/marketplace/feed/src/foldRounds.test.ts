import { describe, it, expect } from 'vitest'
import { foldRounds, type RawMessage } from './foldRounds.js'

const sellers = ['seller-cheap', 'seller-premium', 'seller-lazy']

// A full happy-path round, verbatim from a real devnet run (sigs truncated).
const round1: RawMessage[] = [
  { sender: 'buyer-agent', text: 'WANT round=1 service=coingecko arg=SOL-USDC budget=0.001' },
  { sender: 'seller-premium', text: 'BID round=1 price=0.0005 by=seller-premium note=available' },
  { sender: 'seller-cheap', text: 'BID round=1 price=0.0002 by=seller-cheap note=available' },
  { sender: 'buyer-agent', text: 'AWARD round=1 to=seller-premium reason="verified data worth the premium"' },
  { sender: 'seller-premium', text: 'ESCROW_REQUIRED round=1 reference=DKQy seller=7jwB amount=0.0005 deadline=600' },
  { sender: 'buyer-agent', text: 'DEPOSITED round=1 reference=DKQy buyer=47Dp sig=5syz' },
  { sender: 'seller-premium', text: 'DELIVERED round=1 {"coin":"solana","usd":72.33}' },
  { sender: 'buyer-agent', text: 'RELEASED round=1 sig=3PMa' },
]

describe('foldRounds', () => {
  it('folds a full round to settled with parsed fields', () => {
    const [r] = foldRounds(round1, sellers)
    expect(r.round).toBe(1)
    expect(r.want).toEqual({ service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 })
    expect(r.bids).toHaveLength(2)
    expect(r.award).toEqual({ to: 'seller-premium', reason: 'verified data worth the premium' })
    expect(r.escrow?.amountSol).toBe(0.0005)
    expect(r.deposit?.sig).toBe('5syz')
    expect(r.delivered?.data).toEqual({ coin: 'solana', usd: 72.33 })
    expect(r.release?.sig).toBe('3PMa')
    expect(r.status).toBe('settled')
  })

  it('marks the non-bidding seller as declined (self-selection)', () => {
    const [r] = foldRounds(round1, sellers)
    expect(r.declined).toEqual(['seller-lazy']) // only cheap + premium bid on coingecko
  })

  it('dedupes a seller that bids twice (last write kept by first-wins guard)', () => {
    const msgs: RawMessage[] = [
      { sender: 'buyer-agent', text: 'WANT round=2 service=coingecko arg=x budget=0.001' },
      { sender: 'seller-cheap', text: 'BID round=2 price=0.0002 by=seller-cheap' },
      { sender: 'seller-cheap', text: 'BID round=2 price=0.0003 by=seller-cheap' },
    ]
    expect(foldRounds(msgs).find((r) => r.round === 2)?.bids).toHaveLength(1)
  })

  it('handles a refund-after-deadline round', () => {
    const msgs: RawMessage[] = [
      { sender: 'buyer-agent', text: 'WANT round=3 service=coingecko arg=x budget=0.001' },
      { sender: 'seller-cheap', text: 'BID round=3 price=0.0002 by=seller-cheap' },
      { sender: 'buyer-agent', text: 'AWARD round=3 to=seller-cheap' },
      { sender: 'buyer-agent', text: 'REFUNDED round=3' },
    ]
    expect(foldRounds(msgs).find((r) => r.round === 3)?.status).toBe('refunded')
  })

  it('separates interleaved rounds and sorts ascending', () => {
    const msgs: RawMessage[] = [
      { sender: 'b', text: 'WANT round=2 service=s arg=a budget=0.001' },
      { sender: 'b', text: 'WANT round=1 service=s arg=a budget=0.001' },
      { sender: 'c', text: 'BID round=1 price=0.0002 by=c' },
      { sender: 'c', text: 'BID round=2 price=0.0003 by=c' },
    ]
    const rounds = foldRounds(msgs)
    expect(rounds.map((r) => r.round)).toEqual([1, 2])
  })

  it('leaves an in-progress round in a non-settled status', () => {
    const r = foldRounds(round1.slice(0, 3), sellers)[0]
    expect(r.status).toBe('bidding')
    expect(r.declined).toEqual([]) // bidding still open → not yet declined
  })

  it('folds an AUTHZ_RESULT=verified into round.authz', () => {
    const msgs: RawMessage[] = [
      { sender: 'buyer-agent', text: 'WANT round=7 service=audit arg=hdr+tls budget=0.02' },
      { sender: 'seller-audit', text: 'AUTHZ_RESULT round=7 hash=9f2c1abed4 status=verified' },
    ]
    const r = foldRounds(msgs).find((x) => x.round === 7)!
    expect(r.authz).toEqual({ hash: '9f2c1abed4', status: 'verified' })
  })

  it('folds an AUTHZ_RESULT=rejected with its code + detail', () => {
    const msgs: RawMessage[] = [
      { sender: 'buyer-agent', text: 'WANT round=8 service=audit arg=hdr budget=0.02' },
      {
        sender: 'seller-audit',
        text: 'AUTHZ_RESULT round=8 hash=deadbeef status=rejected code=TARGET_NOT_ALLOWLISTED detail="host is not on the allowlist"',
      },
    ]
    const r = foldRounds(msgs).find((x) => x.round === 8)!
    expect(r.authz).toEqual({
      hash: 'deadbeef',
      status: 'rejected',
      code: 'TARGET_NOT_ALLOWLISTED',
      detail: 'host is not on the allowlist',
    })
  })

  it('collapses a stream of DELIVERY_PROGRESS events to the latest status per stage', () => {
    const msgs: RawMessage[] = [
      { sender: 'buyer-agent', text: 'WANT round=9 service=audit arg=hdr budget=0.02' },
      { sender: 'seller-audit', text: 'DELIVERY_PROGRESS round=9 stage=recon status=active pct=10' },
      { sender: 'seller-audit', text: 'DELIVERY_PROGRESS round=9 stage=recon status=done note="12 routes enumerated"' },
      { sender: 'seller-audit', text: 'DELIVERY_PROGRESS round=9 stage=analysis status=active pct=40' },
      { sender: 'seller-audit', text: 'DELIVERY_PROGRESS round=9 stage=analysis status=done' },
      { sender: 'seller-audit', text: 'DELIVERY_PROGRESS round=9 stage=reporting status=active' },
    ]
    const r = foldRounds(msgs).find((x) => x.round === 9)!
    expect(r.delivery?.stages).toEqual([
      { stage: 'recon', status: 'done', note: '12 routes enumerated', pct: 10 },
      { stage: 'analysis', status: 'done', pct: 40 },
      { stage: 'reporting', status: 'active' },
    ])
  })
})
