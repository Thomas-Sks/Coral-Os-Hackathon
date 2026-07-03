import { motion } from 'framer-motion'
import type { Round } from '../types'
import { persona } from '../persona'
import { fmtSol } from '../format'

interface Props {
  rounds: Round[]
  focused?: number
  following: boolean
  onPick: (round: number) => void
}

/** The compact, clickable index of every round — newest first — that drives the main stage. */
export function RoundsRail({ rounds, focused, following, onPick }: Props) {
  const newestFirst = [...rounds].sort((a, b) => b.round - a.round)
  const newest = newestFirst[0]?.round

  return (
    <aside className="rail" data-testid="rounds-rail" aria-label="rounds">
      <div className="rail-head">
        <span>Rounds</span>
        <span className="rail-count mono">{rounds.length}</span>
      </div>
      <ul className="rail-list">
        {newestFirst.map((r) => {
          const win = r.award ? persona(r.award.to) : undefined
          const price = r.award
            ? r.bids.find((b) => b.by === r.award!.to)?.priceSol
            : r.bids.length
              ? Math.min(...r.bids.map((b) => b.priceSol))
              : undefined
          const live = following && r.round === newest
          return (
            <li key={r.round}>
              <motion.button
                type="button"
                className={`rail-item ${focused === r.round ? 'rail-item-on' : ''}`}
                data-testid="rail-round"
                data-round={r.round}
                aria-current={focused === r.round}
                onClick={() => onPick(r.round)}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
              >
                <span className="rail-n mono">#{r.round}</span>
                <span className="rail-avatar" style={{ ['--pc' as string]: win?.color ?? '#8A90A2' }}>
                  {win ? win.emoji : '·'}
                </span>
                <span className="rail-mid">
                  <span className="rail-label">{win ? win.label : 'Awaiting award'}</span>
                  <span className="rail-price mono">{price != null ? `${fmtSol(price)} SOL` : '—'}</span>
                </span>
                {live ? (
                  <span className="rail-live" title="following live"><span className="rail-live-dot" /></span>
                ) : (
                  <span className={`rail-status rail-status-${r.status}`} title={r.status} />
                )}
              </motion.button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
