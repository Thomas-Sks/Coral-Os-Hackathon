/**
 * The seller's delivery adapter — the AuditMesh fork point.
 *
 * Where the starter's seller sold a TxODDS read, this seller sells a security assessment. It loads
 * the AuditMesh config from env and delegates to `@auditmesh/audit-service`'s `runAudit`, which is
 * the whole delivery graph: verify the signed authorization (live domain control) → re-assert the
 * allowlist → build Strix's rules of engagement → recon/analysis/reporting (Strix live, or a real
 * replayed report in `prebaked` mode) → parse into the report schema. Progress events are forwarded
 * so the index loop can stream them to the market thread (the delivery-graph view).
 */
import {
  loadAuditMeshConfig,
  createLogger,
  type SignedAuthorization,
  type DeliveryProgressEvent,
} from '@auditmesh/shared'
import { runAudit, type RunAuditResult } from '@auditmesh/audit-service'
import type { DomainControlDeps } from '@auditmesh/authorization'

export interface DeliverOptions {
  onProgress: (ev: DeliveryProgressEvent) => void | Promise<void>
  /** Injected domain-control network (defaults to real HTTP/DNS). */
  verifyDeps?: DomainControlDeps
  /** ms since epoch. */
  nowMs: number
  /** Pace synthetic prebaked stages so the delivery graph is watchable. */
  pacingMs?: number
}

/**
 * Run the sold assessment for one awarded, authorized deal. Never throws — returns the typed
 * {@link RunAuditResult} (the index loop turns a failure into a non-delivery, so the buyer refunds).
 */
export async function deliverAudit(
  signed: SignedAuthorization,
  round: number,
  opts: DeliverOptions,
): Promise<RunAuditResult> {
  const config = loadAuditMeshConfig(process.env)
  const log = createLogger(signed.payload.correlationId, {
    component: `seller:${process.env.AGENT_NAME ?? 'audit-seller'}`,
    level: process.env.TRACE === '1' ? 'debug' : 'info',
  })
  return runAudit({
    signed,
    round,
    config,
    nowMs: opts.nowMs,
    llmApiKey: process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    onProgress: opts.onProgress,
    onLine: (line) => log.debug('strix', { line }),
    logger: log,
    verifyDeps: opts.verifyDeps,
    pacingMs: opts.pacingMs ?? Number(process.env.DELIVERY_PACING_MS ?? '1200'),
  })
}
