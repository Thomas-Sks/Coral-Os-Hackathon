import { motion } from 'framer-motion'
import { DEAL_PIPELINE, type DealState } from '@auditmesh/shared'
import { explorerTx, type Round } from '../types'

/** Human labels for the seven forward states of the deal state machine. */
const NODE_LABEL: Record<(typeof DEAL_PIPELINE)[number], string> = {
  WANT: 'Want',
  BID: 'Bid',
  AWARD: 'Award',
  AUTHORIZED: 'Authorized',
  DEPOSITED: 'Deposited',
  DELIVERED: 'Delivered',
  RELEASED: 'Released',
}

interface NodeView {
  state: DealState
  label: string
  reached: boolean
  active: boolean
  /** Explorer link for the on-chain nodes (deposit/release), once reached. */
  sig?: string
  terminal?: 'refund' | 'reject'
}

/**
 * Derive the pipeline nodes from a round. The furthest satisfied node lights everything before it
 * (monotonic fill), so a non-audit round with no AUTHZ verdict still reads as a clean progression.
 * A rejected authorization halts at AWARD; a refund/rejection appends a terminal node.
 */
function buildNodes(round: Round): NodeView[] {
  const conds: { state: (typeof DEAL_PIPELINE)[number]; done: boolean; sig?: string }[] = [
    { state: 'WANT', done: true },
    { state: 'BID', done: round.bids.length > 0 },
    { state: 'AWARD', done: !!round.award },
    { state: 'AUTHORIZED', done: round.authz?.status === 'verified' },
    { state: 'DEPOSITED', done: !!round.deposit, sig: round.deposit?.sig },
    { state: 'DELIVERED', done: !!round.delivered },
    { state: 'RELEASED', done: !!round.release, sig: round.release?.sig },
  ]

  const rejected = round.authz?.status === 'rejected'
  const refunded = round.refunded || round.status === 'refunded'

  let reachedIdx = -1
  conds.forEach((c, i) => { if (c.done) reachedIdx = i })
  if (rejected) reachedIdx = Math.min(reachedIdx, 2) // consent failed → no further progress

  const terminal = rejected || refunded
  const nodes: NodeView[] = conds.map((c, i) => ({
    state: c.state,
    label: NODE_LABEL[c.state],
    reached: i <= reachedIdx,
    active: !terminal && i === reachedIdx,
    sig: i <= reachedIdx ? c.sig : undefined,
  }))

  if (rejected) nodes.push({ state: 'REJECTED', label: 'Rejected', reached: true, active: true, terminal: 'reject' })
  else if (refunded) nodes.push({ state: 'REFUNDED', label: 'Refunded', reached: true, active: true, terminal: 'refund' })

  return nodes
}

/** The narrative spine: WANT → BID → AWARD → AUTHORIZED → DEPOSITED → DELIVERED → RELEASED. */
export function DealPipeline({ round }: { round: Round }) {
  const nodes = buildNodes(round)
  return (
    <div className="pipeline-wrap">
      <ol className="pipeline" data-testid="deal-pipeline" aria-label="deal state machine">
        {nodes.map((n) => {
          const cls = [
            'pl-node',
            n.reached ? 'pl-reached' : 'pl-pending',
            n.active ? 'pl-active' : '',
            n.terminal ? `pl-terminal pl-${n.terminal}` : '',
          ].filter(Boolean).join(' ')

          const inner = (
            <>
              <motion.span
                className="pl-dot"
                aria-hidden
                initial={false}
                animate={n.active ? { scale: [1, 1.35, 1] } : { scale: 1 }}
                transition={n.active
                  ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.3 }}
              />
              <span className="pl-label">{n.label}</span>
            </>
          )

          return (
            <motion.li
              key={n.state}
              className={cls}
              data-node={n.state}
              data-reached={n.reached}
              data-active={n.active}
              initial={{ opacity: 0.35 }}
              animate={{ opacity: n.reached ? 1 : 0.35 }}
              transition={{ duration: 0.4 }}
            >
              {n.sig ? (
                <a
                  className="pl-inner pl-link"
                  href={explorerTx(n.sig)}
                  target="_blank"
                  rel="noreferrer"
                  title={`View ${n.label} on Solana Explorer`}
                >
                  {inner}
                  <span className="pl-ext" aria-hidden>↗</span>
                </a>
              ) : (
                <span className="pl-inner">{inner}</span>
              )}
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}
