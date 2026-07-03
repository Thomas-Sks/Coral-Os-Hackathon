import { motion } from 'framer-motion'
import type { Round, RoundBid } from '../types'
import { persona, BUYER } from '../persona'
import { fmtSol } from '../format'
import { PersonaBadge } from './PersonaBadge'
import { ScopeChips } from './ScopeChips'

/**
 * THE MARKET FLOOR — the negotiation/debate view.
 *
 * For one round we stage the deal as a live back-and-forth: the buyer's ask, the sellers' competing
 * pitches (their bids + the argument in each `note`), the sellers who passed, and — once an award
 * lands — the buyer's verdict with its reasoning as the star quote. Winner glows in its persona
 * color, losers dim.
 */
export function Negotiation({ round }: { round: Round }) {
  const winner = round.award?.to
  // Cheapest pitch first — reads like a bidding war, winner highlighted regardless of order.
  const pitches = [...round.bids].sort((a, b) => a.priceSol - b.priceSol)
  const decided = !!round.award

  return (
    <section className="nego" data-testid="negotiation" aria-label="agent negotiation floor">
      <div className="nego-head">
        <span className="nego-eyebrow">Market floor</span>
        <span className="nego-round mono">Round #{round.round}</span>
        <span className={`nego-phase nego-phase-${round.status}`}>{phaseLabel(round, decided)}</span>
      </div>

      {/* 1 — the ask */}
      {round.want && (
        <motion.div
          className="ask"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
        >
          <PersonaBadge persona={BUYER} size="md" />
          <div className="ask-body">
            <p className="ask-line">Requesting a security assessment</p>
            <div className="ask-meta">
              <ScopeChips arg={round.want.arg} />
              <span className="ask-budget">
                budget <span className="mono">{fmtSol(round.want.budgetSol)} SOL</span>
              </span>
              {round.want.surface && (
                <span className="ask-surface" title="the site the buyer wants audited">
                  site <span className="mono">{round.want.surface.pages} pages · {round.want.surface.forms} forms · {round.want.surface.endpoints} endpoints</span>
                </span>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* 2 — the pitches (the debate) */}
      {pitches.length > 0 ? (
        <div className="pitches" role="list">
          {pitches.map((bid, i) => (
            <PitchCard key={bid.by} bid={bid} won={bid.by === winner} decided={decided} index={i} />
          ))}
        </div>
      ) : (
        <p className="pitches-empty">Sellers are deciding whether to bid…</p>
      )}

      {round.declined.length > 0 && (
        <div className="passed">
          {round.declined.map((name) => {
            const p = persona(name)
            return (
              <span className="passed-chip" key={name} title={name}>
                <span className="passed-emoji" aria-hidden>{p.emoji}</span>
                <span>{p.label} passed — out of scope</span>
              </span>
            )
          })}
        </div>
      )}

      {/* 3 — the verdict */}
      {round.award && (
        <motion.div
          className="verdict"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 210, damping: 22, delay: 0.1 }}
        >
          <div className="verdict-head">
            <PersonaBadge persona={BUYER} size="sm" />
            <span className="verdict-kicker">Buyer's verdict</span>
          </div>
          <p className="verdict-award">
            Awarded to{' '}
            <b className="verdict-winner" style={{ color: persona(round.award.to).color }}>
              {persona(round.award.to).emoji} {persona(round.award.to).label}
            </b>
          </p>
          {round.award.reason && (
            <blockquote className="verdict-quote">
              <p className="reason" data-testid="reason"><em>“{round.award.reason}”</em></p>
            </blockquote>
          )}
        </motion.div>
      )}
    </section>
  )
}

function PitchCard({ bid, won, decided, index }: { bid: RoundBid; won: boolean; decided: boolean; index: number }) {
  const p = persona(bid.by)
  const lost = decided && !won
  return (
    <motion.article
      className={`pitch ${won ? 'pitch-won' : ''} ${lost ? 'pitch-lost' : ''}`}
      style={{ ['--pc' as string]: p.color }}
      data-testid="pitch"
      data-seller={bid.by}
      role="listitem"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: lost ? 0.62 : 1, y: 0, scale: 1 }}
      transition={{ duration: 0.24, ease: 'easeOut', delay: 0.06 * index }}
    >
      <div className="pitch-top">
        <PersonaBadge persona={p} size="md" sub={bid.by} />
        {won && (
          <motion.span
            className="pitch-won-badge"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 16, delay: 0.16 }}
          >
            ★ WON
          </motion.span>
        )}
      </div>
      <div className="pitch-price">
        <span className="pitch-price-n mono">{fmtSol(bid.priceSol)}</span>
        <span className="pitch-price-u">SOL</span>
      </div>
      {bid.note && <p className="pitch-note">“{bid.note}”</p>}
    </motion.article>
  )
}

function phaseLabel(round: Round, decided: boolean): string {
  if (round.status === 'settled') return 'Settled'
  if (round.status === 'refunded') return 'Refunded'
  if (round.status === 'delivered') return 'Delivered'
  if (round.status === 'deposited') return 'In escrow'
  if (decided) return 'Awarded'
  return round.bids.length > 0 ? 'Bidding war' : 'Open call'
}
