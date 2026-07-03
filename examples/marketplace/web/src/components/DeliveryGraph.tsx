import { Fragment } from 'react'
import { motion } from 'framer-motion'
import { DELIVERY_STAGES, DELIVERY_STAGE_LABEL } from '@auditmesh/shared'
import type { Round, RoundDeliveryStage } from '../types'

/** Icon + text label per stage status — color is never the only signal. */
const STATUS_ICON: Record<RoundDeliveryStage['status'], string> = { active: '◐', done: '✓', error: '✕' }
const STATUS_LABEL: Record<RoundDeliveryStage['status'], string> = {
  active: 'running',
  done: 'complete',
  error: 'error',
}

/**
 * The "graph inside a graph": the seller's specialist sub-agents recon → analysis → reporting,
 * folded from the DELIVERY_PROGRESS stream. Rendered only once a delivery has started.
 */
export function DeliveryGraph({ delivery }: { delivery: NonNullable<Round['delivery']> }) {
  const byStage = new Map(delivery.stages.map((s) => [s.stage, s]))
  return (
    <section className="dgraph" data-testid="delivery-graph" aria-label="seller sub-agent pipeline">
      <div className="dgraph-head">Seller sub-agents</div>
      <div className="dgraph-row">
        {DELIVERY_STAGES.map((stage, i) => {
          const s = byStage.get(stage)
          const status = s?.status
          return (
            <Fragment key={stage}>
              <div
                className={`dnode ${status ? `dnode-${status}` : 'dnode-pending'}`}
                data-testid="delivery-stage"
                data-stage={stage}
                data-status={status ?? 'pending'}
              >
                <motion.span
                  className="dnode-icon"
                  aria-hidden
                  animate={status === 'active' ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
                  transition={status === 'active'
                    ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.3 }}
                >
                  {status ? STATUS_ICON[status] : '○'}
                </motion.span>
                <span className="dnode-name">{DELIVERY_STAGE_LABEL[stage]}</span>
                <span className="dnode-status">{status ? STATUS_LABEL[status] : 'waiting'}</span>
                {s?.note && <span className="dnode-note">{s.note}</span>}
              </div>
              {i < DELIVERY_STAGES.length - 1 && <span className="dnode-arrow" aria-hidden>→</span>}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
