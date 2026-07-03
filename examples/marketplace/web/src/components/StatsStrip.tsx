import { safeParseReport } from '@auditmesh/shared'
import { motion } from 'framer-motion'
import type { Round } from '../types'
import { fmtSol } from '../format'

/** A row of premium SaaS stat tiles computed live from the rounds. */
export function StatsStrip({ rounds }: { rounds: Round[] }) {
  const settled = rounds.filter((r) => r.status === 'settled')
  const totalSettled = settled.reduce((sum, r) => sum + (r.escrow?.amountSol ?? 0), 0)

  const findings = rounds.reduce((sum, r) => {
    if (!r.delivered) return sum
    const parsed = safeParseReport(r.delivered.raw)
    return sum + (parsed.ok ? parsed.report.findings.length : 0)
  }, 0)

  const winning = rounds
    .map((r) => (r.award ? r.bids.find((b) => b.by === r.award!.to)?.priceSol : undefined))
    .filter((n): n is number => typeof n === 'number')
  const avgWin = winning.length ? winning.reduce((a, b) => a + b, 0) / winning.length : 0

  const tiles: { label: string; value: string; accent?: boolean }[] = [
    { label: 'Rounds', value: String(rounds.length) },
    { label: 'Settled', value: String(settled.length) },
    { label: 'Total settled', value: `${fmtSol(totalSettled)} SOL`, accent: true },
    { label: 'Findings delivered', value: String(findings) },
    { label: 'Avg winning bid', value: `${fmtSol(avgWin)} SOL` },
  ]

  return (
    <div className="stats" data-testid="stats">
      {tiles.map((t, i) => (
        <motion.div
          key={t.label}
          className={`stat ${t.accent ? 'stat-accent' : ''}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut', delay: 0.04 * i }}
        >
          <span className="stat-value mono">{t.value}</span>
          <span className="stat-label">{t.label}</span>
        </motion.div>
      ))}
    </div>
  )
}
