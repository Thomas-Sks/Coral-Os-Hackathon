/** Renders a txline-edge delivery: the matchup, the de-margined 1X2 odds board, and the LLM call. */
interface Edge {
  service: string
  fixtureId?: string | number
  teams?: { home?: string; away?: string; competition?: string }
  market?: { names?: string[]; pct?: string[] }
  analysis?: unknown
}

function labelFor(name: string, teams?: Edge['teams']): string {
  if (name === 'part1') return teams?.home ?? 'Home'
  if (name === 'part2') return teams?.away ?? 'Away'
  if (name === 'draw') return 'Draw'
  return name
}

/** The seller's `analysis` may be an object, a JSON string {call, confidence}, or plain prose. */
function parseAnalysis(a: unknown): { call?: string; confidence?: number } {
  if (a && typeof a === 'object') return a as { call?: string; confidence?: number }
  if (typeof a === 'string') {
    try {
      const o = JSON.parse(a)
      return o && typeof o === 'object' ? o : { call: a }
    } catch {
      return { call: a }
    }
  }
  return {}
}

export function WorldCupPanel({ edge }: { edge: Edge }) {
  const names = edge.market?.names ?? []
  const pct = edge.market?.pct ?? []
  const { call, confidence } = parseAnalysis(edge.analysis)
  const title = edge.teams?.home && edge.teams?.away
    ? `${edge.teams.home} v ${edge.teams.away}`
    : `fixture ${edge.fixtureId}`
  return (
    <div className="wc-panel" data-testid="wc-edge">
      <div className="wc-head">⚽ {title}{edge.teams?.competition ? ` · ${edge.teams.competition}` : ''}</div>
      {names.length > 0 && (
        <div className="wc-odds">
          {names.map((name, i) => {
            const p = Number(pct[i])
            return (
              <div className="wc-row" key={name}>
                <span className="wc-sel">{labelFor(name, edge.teams)}</span>
                <span className="wc-pct">{Number.isFinite(p) ? `${p.toFixed(0)}%` : '—'}</span>
                <div className="wc-bar"><div className="wc-fill" style={{ width: `${Math.min(100, Number.isFinite(p) ? p : 0)}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}
      {call && (
        <p className="wc-call">
          <strong>edge:</strong> {call}
          {confidence != null && <span className="wc-conf"> · {Math.round(Number(confidence) * 100)}% conf</span>}
        </p>
      )}
    </div>
  )
}
