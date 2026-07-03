import { motion } from 'framer-motion'
import { explorerTx, type Round } from '../types'

/**
 * The money moment. When a round settles (a release signature exists) the agent has *decided to pay*
 * and the payment cleared on-chain. Emphasize it: animate the beat, fire the settlement accent, and
 * surface the Explorer link large and clickable.
 */
export function SettlementMoment({ round }: { round: Round }) {
  if (!round.release) return null
  return (
    <motion.div
      className="settlement"
      data-testid="settlement-moment"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 20 }}
    >
      <div className="settlement-line">
        <motion.span
          className="settlement-icon"
          aria-hidden
          initial={{ scale: 0.5 }}
          animate={{ scale: [0.5, 1.25, 1] }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          ✓
        </motion.span>
        <span className="settlement-copy">
          <strong>Settled on-chain</strong>
          <span className="settlement-sub">
            The buyer accepted the report and released escrow to the seller.
          </span>
        </span>
      </div>
      <a
        className="settlement-link"
        href={explorerTx(round.release.sig)}
        target="_blank"
        rel="noreferrer"
      >
        View settlement on Solana Explorer ↗
      </a>
    </motion.div>
  )
}
