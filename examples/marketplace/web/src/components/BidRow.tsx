import type { RoundBid } from '../types'
import { persona } from '../persona'
import { PersonaBadge } from './PersonaBadge'

/** A single competing bid in the compact history card. */
export function BidRow({ bid, won }: { bid: RoundBid; won: boolean }) {
  return (
    <div className={`bid ${won ? 'bid-won' : ''}`} data-testid="bid" data-seller={bid.by}>
      <PersonaBadge name={bid.by} size="sm" />
      <span className="bid-price mono">{bid.priceSol} SOL</span>
      {bid.note && <span className="bid-note">{bid.note}</span>}
      {won && <span className="bid-tag">won</span>}
    </div>
  )
}

/** A seller that self-selected out of the round. Keeps the raw name visible for traceability. */
export function DeclinedRow({ seller }: { seller: string }) {
  const p = persona(seller)
  return (
    <div className="bid bid-declined" data-testid="declined" data-seller={seller}>
      <span className="persona persona-sm" style={{ ['--pc' as string]: p.color }}>
        <span className="persona-avatar" role="img" aria-label={p.label}>{p.emoji}</span>
      </span>
      <span className="bid-seller">{seller}</span>
      <span className="bid-note">passed — out of scope</span>
    </div>
  )
}
