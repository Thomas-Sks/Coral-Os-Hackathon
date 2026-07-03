import { explorerTx, explorerAddress } from '../types'
import type { Round } from '../types'

/**
 * Session-level on-chain proof, surfaced in the header: a direct Explorer link to the latest settlement
 * (the money moment) and to the buyer wallet — whose devnet address page lists every deposit/release
 * this session made. So the whole session's settlement is one click away, not buried in a round card.
 */
export function SessionExplorer({ rounds }: { rounds: Round[] }) {
  const settled = rounds.filter((r) => r.release?.sig).sort((a, b) => a.round - b.round)
  const latest = settled[settled.length - 1]
  const buyer = rounds.find((r) => r.deposit?.buyer)?.deposit?.buyer

  if (!latest && !buyer) return null

  return (
    <div className="sess-explorer" data-testid="session-explorer">
      <span className="sx-label">On-chain (devnet):</span>
      {latest?.release?.sig && (
        <a
          className="sx-link sx-settle"
          href={explorerTx(latest.release.sig)}
          target="_blank"
          rel="noreferrer"
          title={latest.release.sig}
          data-testid="session-settlement"
        >
          ◎ Latest settlement · round {latest.round} ↗
        </a>
      )}
      {buyer && (
        <a className="sx-link" href={explorerAddress(buyer)} target="_blank" rel="noreferrer" title={buyer}>
          All session activity ↗
        </a>
      )}
      {settled.length > 0 && (
        <span className="sx-count">{settled.length} settled</span>
      )}
    </div>
  )
}
