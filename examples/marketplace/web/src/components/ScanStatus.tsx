import { motion } from 'framer-motion'
import type { ScanStatus } from '../api'

/**
 * Shown while the security agent runs its live Strix pentest on the host (before the market opens).
 * Turns the "nothing yet" gap into a visible "the agent is working" beat.
 */
export function ScanStatusHero({ scan }: { scan: ScanStatus }) {
  const elapsed = scan.startedAt ? Math.max(0, Math.floor((Date.now() - scan.startedAt) / 1000)) : 0
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  // Scan finished but the market hasn't opened yet — bridge the gap with a "complete, opening" beat.
  if (scan.done && !scan.running) {
    return (
      <motion.section
        className="scan-hero scan-hero-done"
        data-testid="scan-hero"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="scan-head">
          <span className="scan-avatar" aria-hidden>✅</span>
          <div className="scan-headings">
            <div className="scan-title">Pentest complete{typeof scan.findings === 'number' ? ` — ${scan.findings} findings` : ''}</div>
            <div className="scan-sub">Opening the market — the sellers will now compete to deliver this report…</div>
          </div>
        </div>
        <div className="scan-bar"><span className="scan-bar-done" /></div>
      </motion.section>
    )
  }

  return (
    <motion.section
      className="scan-hero"
      data-testid="scan-hero"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <div className="scan-head">
        <motion.span
          className="scan-avatar"
          aria-hidden
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
        >
          🛡️
        </motion.span>
        <div className="scan-headings">
          <div className="scan-title">
            <span className="scan-live-dot" /> Security agent — running a live pentest
            {scan.scanMode && <span className="scan-mode">{scan.scanMode} depth</span>}
          </div>
          <div className="scan-sub">
            A real Strix assessment against <span className="mono">{scan.target ?? 'the target'}</span>.
            The agent must finish before it can deliver — the market opens when the scan completes.
          </div>
        </div>
        <span className="scan-timer mono" title="elapsed">{mm}:{ss}</span>
      </div>

      <div className="scan-bar" role="progressbar" aria-label="scan in progress">
        <motion.span
          className="scan-bar-fill"
          animate={{ x: ['-45%', '145%'] }}
          transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      {scan.scope && scan.scope.length > 0 && (
        <div className="scan-scope">
          {scan.scope.map((c) => (
            <span key={c} className="scan-chip">{c}</span>
          ))}
        </div>
      )}

      <div className="scan-activity mono" data-testid="scan-activity">
        <span className="scan-caret">›</span> {scan.activity || 'initializing Strix sandbox…'}
      </div>
    </motion.section>
  )
}
