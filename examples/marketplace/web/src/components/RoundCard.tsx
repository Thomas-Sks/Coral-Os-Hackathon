import { safeParseReport } from '@auditmesh/shared'
import type { Round } from '../types'
import { StatusPill } from './StatusPill'
import { BidRow, DeclinedRow } from './BidRow'
import { SettlementBadge } from './SettlementBadge'
import { WorldCupPanel } from './WorldCupPanel'
import { DealPipeline } from './DealPipeline'
import { DeliveryGraph } from './DeliveryGraph'
import { AuthzBadge } from './AuthzBadge'
import { ReportPanel } from './ReportPanel'
import { SettlementMoment } from './SettlementMoment'

/** One auction round: the deal spine, the competing bids, consent, delivery, and on-chain settlement. */
export function RoundCard({ round }: { round: Round }) {
  const winner = round.award?.to
  const isAudit = round.want?.service === 'audit'
  // The delivered payload may be an AuditReport (render the findings panel) or anything else
  // (txodds edge / raw) — parse it once and let the schema decide.
  const report = round.delivered ? safeParseReport(round.delivered.raw) : undefined

  return (
    <article className="round" data-testid="round" data-round={round.round}>
      <header className="round-head">
        <span className="round-n">#{round.round}</span>
        {round.want && (
          <span className="round-want">
            <strong>{round.want.service}</strong> {round.want.arg}
            <span className="round-budget">budget {round.want.budgetSol} SOL</span>
          </span>
        )}
        <StatusPill status={round.status} />
      </header>

      <DealPipeline round={round} />

      <div className="bids">
        {round.bids.map((b) => (
          <BidRow key={b.by} bid={b} won={b.by === winner} />
        ))}
        {round.declined.map((s) => (
          <DeclinedRow key={s} seller={s} />
        ))}
      </div>

      {round.award?.reason && (
        <div className="reason-block">
          <span className="reason-label">Buyer’s decision-to-pay</span>
          <p className="reason" data-testid="reason">
            <em>“{round.award.reason}”</em>
          </p>
        </div>
      )}

      {(round.authz || isAudit) && <AuthzBadge authz={round.authz} />}

      {round.delivery && <DeliveryGraph delivery={round.delivery} />}

      {round.delivered && (
        report && report.ok ? (
          <ReportPanel report={report.report} />
        ) : (round.delivered.data as { service?: string } | undefined)?.service === 'txline-edge' ? (
          <WorldCupPanel edge={round.delivered.data as Parameters<typeof WorldCupPanel>[0]['edge']} />
        ) : (
          <pre className="delivered" data-testid="delivered">{round.delivered.raw}</pre>
        )
      )}

      {round.release && <SettlementMoment round={round} />}

      <footer className="settle-row">
        {round.deposit && <SettlementBadge label={`deposit ${round.escrow?.amountSol ?? ''} SOL`} sig={round.deposit.sig} />}
        {round.release && <SettlementBadge label="release" sig={round.release.sig} />}
        {round.refunded && <span className="settle settle-refund" data-testid="refund">refunded</span>}
      </footer>
    </article>
  )
}
