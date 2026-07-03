import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { RoundCard } from './RoundCard'
import { settledRound, auditRound, rejectedRound } from '../../tests/fixtures'

afterEach(cleanup)

describe('RoundCard', () => {
  it('renders the want, both bids, and the declined seller', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getByTestId('round').getAttribute('data-round')).toBe('1')
    expect(screen.getAllByTestId('bid')).toHaveLength(2)
    expect(screen.getByTestId('declined').getAttribute('data-seller')).toBe('seller-lazy')
  })

  it('highlights the winning bid with a "won" tag', () => {
    render(<RoundCard round={settledRound} />)
    const winner = screen.getAllByTestId('bid').find((el) => el.getAttribute('data-seller') === 'seller-premium')!
    expect(winner.className).toContain('bid-won')
    expect(within(winner).getByText('won')).toBeTruthy()
  })

  it('shows the LLM award reasoning', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getByTestId('reason').textContent).toContain('verified data worth the premium')
  })

  it('links deposit + release to the devnet Explorer with the right sigs', () => {
    render(<RoundCard round={settledRound} />)
    const links = screen.getAllByTestId('settle') as HTMLAnchorElement[]
    expect(links).toHaveLength(2)
    expect(links.some((a) => a.href.includes('3PMa9LBZn7VEMD1qZnmr') && a.href.includes('cluster=devnet'))).toBe(true)
  })

  it('shows the status pill as settled', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getByTestId('status').textContent).toBe('settled')
  })

  it('renders the deal pipeline with the RELEASED node reached', () => {
    render(<RoundCard round={settledRound} />)
    const pipeline = screen.getByTestId('deal-pipeline')
    const released = within(pipeline).getByText('Released').closest('[data-node]')!
    expect(released.getAttribute('data-reached')).toBe('true')
  })

  it('keeps deposit + release settle links to exactly two (pipeline links are not testid=settle)', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getAllByTestId('settle')).toHaveLength(2)
  })
})

describe('RoundCard — AuditMesh audit round', () => {
  it('shows verified on-chain consent', () => {
    render(<RoundCard round={auditRound} />)
    const badge = screen.getByTestId('authz-badge')
    expect(badge.getAttribute('data-status')).toBe('verified')
    expect(badge.textContent).toContain('Consent verified on-chain')
  })

  it('renders the seller delivery graph with three completed stages', () => {
    render(<RoundCard round={auditRound} />)
    expect(screen.getByTestId('delivery-graph')).toBeTruthy()
    const stages = screen.getAllByTestId('delivery-stage')
    expect(stages).toHaveLength(3)
    expect(stages.every((s) => s.getAttribute('data-status') === 'done')).toBe(true)
  })

  it('renders the delivered report (not raw JSON) with findings worst-first', () => {
    render(<RoundCard round={auditRound} />)
    const panel = screen.getByTestId('report-panel')
    expect(panel).toBeTruthy()
    expect(screen.queryByTestId('delivered')).toBeNull() // no raw <pre> fallback
    const findings = screen.getAllByTestId('finding')
    expect(findings).toHaveLength(3)
    expect(findings[0].getAttribute('data-severity')).toBe('critical')
    expect(within(panel).getByText('SQL injection in product search')).toBeTruthy()
  })

  it('emphasizes the settlement moment with the Explorer release link', () => {
    render(<RoundCard round={auditRound} />)
    const moment = screen.getByTestId('settlement-moment')
    const link = within(moment).getByText(/View settlement on Solana Explorer/) as HTMLAnchorElement
    expect(link.getAttribute('href')).toContain('3PMa9LBZn7VEMD1qZnmr')
  })
})

describe('RoundCard — rejected authorization', () => {
  it('surfaces the rejection state with its code and detail, halting the pipeline', () => {
    render(<RoundCard round={rejectedRound} />)
    const badge = screen.getByTestId('authz-badge')
    expect(badge.getAttribute('data-status')).toBe('rejected')
    expect(badge.textContent).toContain('TARGET_NOT_ALLOWLISTED')
    expect(badge.textContent).toContain('not on the allowlist')
    // pipeline shows a terminal REJECTED node
    const pipeline = screen.getByTestId('deal-pipeline')
    expect(within(pipeline).getByText('Rejected')).toBeTruthy()
  })
})
