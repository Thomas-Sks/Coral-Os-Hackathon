import { persona } from '../persona'

/** Who's in the market and what each actually delivers — so the negotiation is legible. */
const ROLES: { name: string; role: string; offer: string; depth?: string }[] = [
  {
    name: 'audit-buyer',
    role: 'Client',
    offer:
      'Posts an audit job (scope + budget), weighs the competing bids for best value, proves control of the target and signs on-chain consent, then decides to pay once the report is delivered.',
  },
  {
    name: 'audit-discounter',
    role: 'Seller',
    offer: 'A fast, low-cost pass over security headers + TLS only. Cheapest and quickest.',
    depth: 'quick scan',
  },
  {
    name: 'audit-tls-specialist',
    role: 'Seller',
    offer: 'A standard-depth expert review of TLS + header configuration. Only bids on config-only jobs; passes otherwise.',
    depth: 'standard scan',
  },
  {
    name: 'audit-premium',
    role: 'Seller',
    offer:
      'The deepest scan available (deep mode) of whatever scope the buyer authorizes — and it takes the broadest jobs the others decline. Depth + coverage of the granted scope, not families beyond it. Priciest.',
    depth: 'deep scan',
  },
]

export function PersonaLegend() {
  return (
    <div className="legend" data-testid="persona-legend">
      <p className="legend-note">
        Every scan is bounded by the scope the buyer <strong>requests and authorizes on-chain</strong> — a
        seller assesses exactly that, no more (even premium). Personas differ by <strong>depth</strong> and
        which scopes they’ll take.
      </p>
      <div className="legend-grid">
        {ROLES.map((r) => {
          const p = persona(r.name)
          return (
            <div key={r.name} className="legend-card" style={{ ['--pc' as string]: p.color }}>
              <div className="legend-top">
                <span className="legend-avatar" style={{ background: `${p.color}1a`, borderColor: `${p.color}55` }}>
                  {p.emoji}
                </span>
                <div className="legend-heads">
                  <div className="legend-name">{p.label}</div>
                  <div className="legend-role">
                    {r.role}
                    {r.depth && <span className="legend-depth">{r.depth}</span>}
                  </div>
                </div>
              </div>
              <div className="legend-offer">{r.offer}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
