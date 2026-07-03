import { safeParseReport } from '@auditmesh/shared'
import type { Round } from '../types'
import { DealPipeline } from './DealPipeline'
import { AuthzBadge } from './AuthzBadge'
import { DeliveryGraph } from './DeliveryGraph'
import { ReportPanel } from './ReportPanel'
import { WorldCupPanel } from './WorldCupPanel'
import { SettlementMoment } from './SettlementMoment'

/**
 * The on-chain half of the focused round — the deal spine, consent verdict, seller sub-agents,
 * the delivered artifact, and the settlement moment. Mirrors RoundCard's payload logic so the
 * hero stage shows the full story while the history rail keeps the compact cards.
 */
export function RoundDetail({ round }: { round: Round }) {
  const isAudit = round.want?.service === 'audit'
  const report = round.delivered ? safeParseReport(round.delivered.raw) : undefined

  return (
    <div className="detail">
      <DealPipeline round={round} />

      {(round.authz || isAudit) && <AuthzBadge authz={round.authz} />}

      {round.delivery && <DeliveryGraph delivery={round.delivery} />}

      {round.delivered &&
        (report && report.ok ? (
          <ReportPanel report={report.report} />
        ) : (round.delivered.data as { service?: string } | undefined)?.service === 'txline-edge' ? (
          <WorldCupPanel edge={round.delivered.data as Parameters<typeof WorldCupPanel>[0]['edge']} />
        ) : (
          <pre className="delivered" data-testid="delivered">{round.delivered.raw}</pre>
        ))}

      {round.release && <SettlementMoment round={round} />}
    </div>
  )
}
