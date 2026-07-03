import { describe, it, expect } from 'vitest'
import { parsePaymentRequired, pickCheapest, type Quote } from './logic.js'

const REF = 'Fk1pGh9YFt4XqsmPJ7v4kN5Hfc9CE4iDzPRg5eNBjeMa' // valid base58 pubkey

describe('parsePaymentRequired', () => {
  it('parses a well-formed seller quote', () => {
    const q = parsePaymentRequired(`PAYMENT_REQUIRED reference=${REF} amount=0.0001 url=solana:abc?amount=0.0001`)
    expect(q).not.toBeNull()
    expect(q!.amount).toBe(0.0001)
    expect(q!.reference).toBe(REF)
    expect(q!.url.startsWith('solana:')).toBe(true)
  })

  it('returns null when fields are missing or malformed', () => {
    expect(parsePaymentRequired('hello world')).toBeNull()
    expect(parsePaymentRequired(`PAYMENT_REQUIRED reference=${REF}`)).toBeNull() // no amount/url
    expect(parsePaymentRequired('PAYMENT_REQUIRED amount=0.0001 url=solana:x')).toBeNull() // no reference
  })
})

describe('pickCheapest', () => {
  const q = (seller: string, amount: number): Quote => ({ seller, thread: 't', amount, reference: REF, url: 'solana:x' })

  it('returns the lowest-priced quote', () => {
    const best = pickCheapest([q('premium', 0.0003), q('cheap', 0.0001), q('mid', 0.0002)])
    expect(best!.seller).toBe('cheap')
  })

  it('does not mutate the input order', () => {
    const quotes = [q('premium', 0.0003), q('cheap', 0.0001)]
    pickCheapest(quotes)
    expect(quotes[0].seller).toBe('premium') // original array untouched
  })

  it('returns undefined for no quotes', () => {
    expect(pickCheapest([])).toBeUndefined()
  })
})
