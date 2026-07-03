/**
 * The delivery pipeline — the sold artifact end to end.
 *
 * `runAudit` is the seller's delivery graph in code form:
 *   1. verify the signed, scoped authorization (LIVE domain control) — the enforced consent gate
 *   2. re-assert the target is on the allowlist — the hard boundary, defense in depth
 *   3. build Strix's rules of engagement from the granted scope
 *   4. recon → analysis → reporting, delegating to Strix (live) or replaying a real report (prebaked),
 *      emitting delivery-graph progress at each stage
 *   5. parse into the report schema and return the paid deliverable string
 *
 * Every failure is a typed result, never a throw, so the seller degrades cleanly (no DELIVERED →
 * the buyer's escrow refunds on the deadline). `deliverService` is the thin, documented fork-point
 * wrapper matching the starter's `(request: string) => Promise<string>` contract.
 */

import {
  isAllowlisted,
  serializeReport,
  createLogger,
  DEFAULT_SCOPE_POLICY,
  AUDIT_SERVICE,
  DELIVERY_STAGES,
  type AuditReport,
  type AuditMeshConfig,
  type Finding,
  type Scope,
  type ScopePolicy,
  type DeliveryProgressEvent,
  type DeliveryStage,
  type AuthzFailureCode,
  type Logger,
  type SignedAuthorization,
} from '@auditmesh/shared'
import {
  verifyAuthorization,
  decodeGrant,
  type DomainControlDeps,
} from '@auditmesh/authorization'
import { buildInstruction } from './instruction.js'
import { runStrix, readStrixRun, type StrixErrorCode } from './strix.js'
import { buildReport } from './parser.js'
import { loadPrebakedFindings } from './prebaked.js'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

export type ProgressSink = (ev: DeliveryProgressEvent) => void | Promise<void>

export interface RunAuditInput {
  signed: SignedAuthorization
  round: number
  config: AuditMeshConfig
  /** ms since epoch — injected for determinism. */
  nowMs: number
  /** LLM key handed to Strix as LLM_API_KEY (live mode). */
  llmApiKey?: string
  /** Scope policy ceiling; defaults to the conservative bundled policy. */
  policy?: ScopePolicy
  /** Emits delivery-graph stage events (wire to the CoralOS thread in the seller). */
  onProgress?: ProgressSink
  /** Raw Strix stdout lines (live mode) — for logs/notes. */
  onLine?: (line: string) => void
  logger?: Logger
  /** Injected network for the live domain-control recheck. */
  verifyDeps?: DomainControlDeps
  /** Delay between synthetic stages so the delivery graph is watchable (prebaked/demo). 0 in tests. */
  pacingMs?: number
  /** Injected sleep for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Injected spawn for tests (live mode). */
  spawnImpl?: typeof import('node:child_process').spawn
}

export type RunAuditResult =
  | { ok: true; report: AuditReport; serialized: string; authzHash: string }
  | { ok: false; stage: 'authorization'; code: AuthzFailureCode; reason: string; authzHash: string }
  | {
      ok: false
      stage: 'delivery'
      code: StrixErrorCode | 'PREBAKED_MISSING'
      reason: string
      authzHash: string
    }

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Run the full authorized assessment. Never throws; returns a typed result. */
export async function runAudit(input: RunAuditInput): Promise<RunAuditResult> {
  const log = input.logger ?? createLogger(input.signed.payload.correlationId, { component: 'audit-service' })
  const authzHash = input.signed.authzHash
  const sleep = input.sleep ?? defaultSleep
  const pacing = input.pacingMs ?? 0
  const emit = async (ev: DeliveryProgressEvent) => {
    await input.onProgress?.(ev)
    log.event('delivery-progress', { ...ev })
  }

  // 1. Enforced consent gate.
  const verdict = await verifyAuthorization(input.signed, {
    policy: input.policy ?? DEFAULT_SCOPE_POLICY,
    nowMs: input.nowMs,
    domainControl: input.verifyDeps,
  })
  if (!verdict.ok) {
    log.event('authorization', { status: 'rejected', code: verdict.code, reason: verdict.reason }, 'warn')
    return { ok: false, stage: 'authorization', code: verdict.code, reason: verdict.reason, authzHash }
  }
  log.event('authorization', { status: 'verified', target: verdict.target })

  // 2. Hard boundary, defense in depth (the verifier already checked, we re-assert at the edge).
  const target = verdict.target
  if (!isAllowlisted(target)) {
    return {
      ok: false,
      stage: 'authorization',
      code: 'TARGET_NOT_ALLOWLISTED',
      reason: `target ${target} is not allowlisted`,
      authzHash,
    }
  }
  const grantedScope = verdict.scope

  // 3. Rules of engagement.
  const instruction = buildInstruction({
    target,
    scope: grantedScope,
    correlationId: input.signed.payload.correlationId,
  })

  // 4. recon → analysis → reporting.
  if (input.config.reportSource === 'prebaked') {
    return await deliverPrebaked({ input, log, emit, sleep, pacing, target, grantedScope, authzHash })
  }
  return await deliverLive({ input, log, emit, target, grantedScope, authzHash, instruction })
}

// ── prebaked path ────────────────────────────────────────────────────────────

async function deliverPrebaked(args: {
  input: RunAuditInput
  log: Logger
  emit: (ev: DeliveryProgressEvent) => Promise<void>
  sleep: (ms: number) => Promise<void>
  pacing: number
  target: string
  grantedScope: Scope
  authzHash: string
}): Promise<RunAuditResult> {
  const { input, emit, sleep, pacing, target, grantedScope, authzHash } = args
  const round = input.round

  // Animate the delivery graph so the "graph inside a graph" reads even on a replayed report.
  for (const stage of DELIVERY_STAGES) {
    await emit({ round, stage, status: 'active', note: prebakedNote(stage) })
    if (pacing > 0) await sleep(pacing)
  }

  const loaded = await loadPrebakedFindings(input.config.prebakedReportPath)
  if (!loaded.ok) {
    await emit({ round, stage: 'reporting', status: 'error', note: 'prebaked report unavailable' })
    return { ok: false, stage: 'delivery', code: 'PREBAKED_MISSING', reason: loaded.reason, authzHash }
  }

  const report = buildReport({
    findings: loaded.findings,
    target,
    grantedScope,
    provenance: {
      source: 'prebaked',
      engine: 'strix',
      engineModel: input.config.strixModel,
      scanMode: input.config.scanMode,
    },
    correlationId: input.signed.payload.correlationId,
    generatedAt: new Date(input.nowMs).toISOString(),
  })

  for (const stage of DELIVERY_STAGES) {
    await emit({ round, stage, status: 'done' })
  }
  return { ok: true, report, serialized: serializeReport(report), authzHash }
}

function prebakedNote(stage: DeliveryStage): string {
  return stage === 'recon'
    ? 'enumerating surface (replayed)'
    : stage === 'analysis'
      ? 'classifying weaknesses (replayed)'
      : 'compiling findings (replayed)'
}

// ── live path ────────────────────────────────────────────────────────────────

async function deliverLive(args: {
  input: RunAuditInput
  log: Logger
  emit: (ev: DeliveryProgressEvent) => Promise<void>
  target: string
  grantedScope: Scope
  authzHash: string
  instruction: string
}): Promise<RunAuditResult> {
  const { input, log, emit, target, grantedScope, authzHash, instruction } = args
  const round = input.round

  // If a host-side scan broker is configured, the seller (which can't run Docker-in-Docker) delegates
  // the real scan to it — AFTER winning, scoped to the granted offer. This is the market delivery path.
  const brokerUrl = process.env.SCAN_BROKER_URL
  if (brokerUrl) {
    await emit({ round, stage: 'recon', status: 'done' })
    await emit({ round, stage: 'analysis', status: 'active', note: 'running the live pentest…' })
    // The scan takes minutes; emit a heartbeat every 20s so the seller stays active on the coral bus
    // and the dashboard's delivery graph keeps updating while the scan runs.
    let secs = 0
    const heart = setInterval(() => {
      secs += 20
      void emit({ round, stage: 'analysis', status: 'active', note: `scanning the target… ${secs}s elapsed` })
    }, 20_000)
    try {
      const res = await fetch(`${brokerUrl.replace(/\/$/, '')}/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          target,
          categories: grantedScope.categories,
          correlationId: input.signed.payload.correlationId,
          round,
          scanMode: input.config.scanMode, // the winning persona's depth (quick | standard | deep)
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; findings?: Finding[]; runName?: string; error?: string }
      clearInterval(heart)
      if (!res.ok || !data.ok || !Array.isArray(data.findings)) {
        await emit({ round, stage: 'analysis', status: 'error', note: `broker ${res.status}` })
        return { ok: false, stage: 'delivery', code: 'STRIX_NO_OUTPUT', reason: data.error ?? `scan broker ${res.status}`, authzHash }
      }
      await emit({ round, stage: 'analysis', status: 'done' })
      await emit({ round, stage: 'reporting', status: 'active', note: 'compiling findings' })
      const report = buildReport({
        findings: data.findings,
        target,
        grantedScope,
        provenance: { source: 'live', engine: 'strix', engineModel: input.config.strixModel, scanMode: input.config.scanMode, runName: data.runName },
        correlationId: input.signed.payload.correlationId,
        generatedAt: new Date(input.nowMs).toISOString(),
      })
      await emit({ round, stage: 'reporting', status: 'done' })
      return { ok: true, report, serialized: serializeReport(report), authzHash }
    } catch (e) {
      clearInterval(heart)
      await emit({ round, stage: 'analysis', status: 'error', note: 'broker unreachable' })
      return { ok: false, stage: 'delivery', code: 'STRIX_SPAWN_FAILED', reason: `scan broker unreachable: ${e instanceof Error ? e.message : String(e)}`, authzHash }
    }
  }

  // Working dir for this run's instruction file + strix_runs output.
  const workingDir = path.resolve(input.config.strixRunsDir)
  let instructionPath: string
  try {
    await fs.mkdir(workingDir, { recursive: true })
    instructionPath = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), 'auditmesh-')),
      'instruction.md',
    )
    await fs.writeFile(instructionPath, instruction, 'utf8')
  } catch (err) {
    return {
      ok: false,
      stage: 'delivery',
      code: 'STRIX_SPAWN_FAILED',
      reason: `could not stage instruction: ${err instanceof Error ? err.message : String(err)}`,
      authzHash,
    }
  }

  await emit({ round, stage: 'recon', status: 'active', note: 'starting Strix sandbox' })

  // Map Strix stdout to coarse delivery stages: first output ends recon, close ends analysis.
  let stage: DeliveryStage = 'recon'
  const onLine = (line: string) => {
    input.onLine?.(line)
    if (stage === 'recon') {
      stage = 'analysis'
      void emit({ round, stage: 'recon', status: 'done' })
      void emit({ round, stage: 'analysis', status: 'active', note: 'analyzing responses' })
    }
  }

  const result = await runStrix({
    target,
    scanMode: input.config.scanMode,
    instructionPath,
    model: input.config.strixModel,
    llmApiKey: input.llmApiKey ?? process.env.LLM_API_KEY ?? '',
    timeoutSeconds: input.config.strixTimeoutSeconds,
    workingDir,
    onLine,
    spawnImpl: input.spawnImpl,
  })

  if (!result.ok) {
    await emit({ round, stage, status: 'error', note: result.code })
    log.error('strix failed', { code: result.code, reason: result.reason })
    return { ok: false, stage: 'delivery', code: result.code, reason: result.reason, authzHash }
  }

  await emit({ round, stage: 'analysis', status: 'done' })
  await emit({ round, stage: 'reporting', status: 'active', note: 'parsing findings' })

  const parsed = await readStrixRun(result.runDir)
  const report = buildReport({
    findings: parsed.findings,
    target,
    grantedScope,
    provenance: {
      source: 'live',
      engine: 'strix',
      engineModel: input.config.strixModel,
      scanMode: input.config.scanMode,
      runName: parsed.runName,
    },
    correlationId: input.signed.payload.correlationId,
    generatedAt: new Date(input.nowMs).toISOString(),
  })

  await emit({ round, stage: 'reporting', status: 'done' })
  return { ok: true, report, serialized: serializeReport(report), authzHash }
}

// ── deliverService — the documented fork point ───────────────────────────────

export interface DeliverServiceRequest {
  /** Market round this delivery is for. */
  round: number
  /** base64url AUTHZ_GRANT token (a SignedAuthorization). */
  grantToken: string
  /** ms since epoch. */
  nowMs: number
}

export interface DeliverServiceDeps {
  config: AuditMeshConfig
  llmApiKey?: string
  policy?: ScopePolicy
  onProgress?: ProgressSink
  onLine?: (line: string) => void
  logger?: Logger
  verifyDeps?: DomainControlDeps
  pacingMs?: number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The fork point: `deliverService(request) => Promise<string>`. `request` is a JSON-encoded
 * {@link DeliverServiceRequest}; the return is the serialized report (the paid deliverable) or, on
 * any failure, `JSON.stringify({ error })`. Never throws — matching the starter's contract.
 */
export async function deliverService(request: string, deps: DeliverServiceDeps): Promise<string> {
  try {
    const req = JSON.parse(request) as DeliverServiceRequest
    const decoded = decodeGrant(req.grantToken)
    if (!decoded.ok) {
      return JSON.stringify({ error: { stage: 'authorization', code: 'MALFORMED', reason: decoded.reason } })
    }
    const result = await runAudit({
      signed: decoded.signed,
      round: req.round,
      config: deps.config,
      nowMs: req.nowMs,
      llmApiKey: deps.llmApiKey,
      policy: deps.policy,
      onProgress: deps.onProgress,
      onLine: deps.onLine,
      logger: deps.logger,
      verifyDeps: deps.verifyDeps,
      pacingMs: deps.pacingMs,
      sleep: deps.sleep,
    })
    if (result.ok) return result.serialized
    return JSON.stringify({
      error: { stage: result.stage, code: result.code, reason: result.reason },
    })
  } catch (err) {
    return JSON.stringify({
      error: { stage: 'delivery', code: 'PARSE_FAILED', reason: err instanceof Error ? err.message : String(err) },
    })
  }
}

/** Convenience re-export so callers can gate on the routed service name. */
export { AUDIT_SERVICE }
