/**
 * Configuration + the target allowlist — the hard security boundary.
 *
 * The allowlist is a frozen constant, NOT a tunable. There is deliberately no env var, flag, or
 * config field that can widen it to an arbitrary host: the scanner can only ever be pointed at the
 * bundled, self-hosted, deliberately-vulnerable target. `isAllowlisted()` is called at the code
 * boundary in both the authorization verifier and `deliverService()`, and a miss is a hard stop.
 *
 * Everything else here (report source, scan mode, timeouts, budgets) is a validated tunable read
 * from an env record the caller passes in — the module never touches `process.env` itself, so it
 * stays safe to import from the browser dashboard.
 */

import { z } from 'zod'

/**
 * The ONLY hosts a scan may target. All entries resolve to the bundled OWASP Juice Shop, reached
 * either through the compose front-door (which also serves the domain-control token) or directly.
 * Adding an external URL here would violate the project's core guardrail — don't.
 */
export const TARGET_ALLOWLIST: readonly string[] = Object.freeze([
  'http://localhost:8899', // front-door published to the host (compose)
  'http://127.0.0.1:8899',
  'http://target-frontdoor', // front-door, internal compose network (port 80)
  'http://target-frontdoor:80',
  'http://juice-shop:3000', // Juice Shop directly, internal compose network
  'http://localhost:3000', // Juice Shop for a bare local dev run
  'http://host.docker.internal:8899', // front-door reached from an agent container via the host
  'http://host.docker.internal:3000', // Juice Shop reached from an agent container via the host
  'http://172.17.0.1:8899', // front-door via the docker0 bridge gateway (Linux host, default network)
  'http://172.17.0.1:3000', // Juice Shop via the docker0 bridge gateway
])

/**
 * Normalize a target for comparison: lowercase scheme+host, strip a trailing slash and any
 * path/query/hash. Returns null if it isn't a parseable http(s) origin. Keeping this strict means
 * `http://juice-shop:3000/../evil` and `http://localhost:8899@evil.com` can never sneak through.
 */
export function normalizeTarget(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  // Reject embedded credentials outright — a classic allowlist-bypass vector.
  if (url.username || url.password) return null
  return `${url.protocol}//${url.host}`.toLowerCase()
}

/** True only if `raw` normalizes to an allowlisted origin. The scanner's hard boundary. */
export function isAllowlisted(raw: string): boolean {
  const norm = normalizeTarget(raw)
  if (norm === null) return false
  return TARGET_ALLOWLIST.some((entry) => normalizeTarget(entry) === norm)
}

export const ReportSource = z.enum(['live', 'prebaked'])
export type ReportSource = z.infer<typeof ReportSource>

export const ScanMode = z.enum(['quick', 'standard', 'deep'])
export type ScanMode = z.infer<typeof ScanMode>

/** Coerce a possibly-undefined env string into a number, falling back to `dflt`. */
const num = (v: string | undefined, dflt: number) => {
  if (v === undefined || v.trim() === '') return dflt
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

export const AuditMeshConfig = z
  .object({
    /** 'live' actually runs Strix; 'prebaked' replays a stored real Strix report. Settlement is */
    /** always live on devnet regardless. */
    reportSource: ReportSource,
    scanMode: ScanMode,
    /** Strix LLM in provider/model form, e.g. "anthropic/claude-sonnet-4-6". */
    strixModel: z.string().min(1),
    /** Hard wall-clock cap for a live Strix subprocess, in seconds. */
    strixTimeoutSeconds: z.number().int().min(30).max(3600),
    /** Where a live run writes its output (Strix creates strix_runs/<run> beneath this). */
    strixRunsDir: z.string().min(1),
    /** File served in 'prebaked' mode — a previously-generated REAL Strix report (our schema JSON). */
    prebakedReportPath: z.string().min(1),
    /** The target the seller assesses. MUST be allowlisted (validated below). */
    target: z.string().refine(isAllowlisted, {
      message: 'target is not on the AuditMesh allowlist',
    }),
    /** Buyer budget ceiling in SOL for an audit WANT (code-enforced upper bound on bids). */
    defaultBudgetSol: z.number().positive(),
  })
  .strict()
export type AuditMeshConfig = z.infer<typeof AuditMeshConfig>

/**
 * Build a validated config from an env record. Defaults are demo-safe: prebaked source (so a filmed
 * run is deterministic), quick scan, the bundled front-door target. Throws a zod error if any value
 * is out of range or the target is not allowlisted.
 */
export function loadAuditMeshConfig(
  env: Record<string, string | undefined> = {},
): AuditMeshConfig {
  return AuditMeshConfig.parse({
    reportSource: env.REPORT_SOURCE ?? 'prebaked',
    scanMode: env.SCAN_MODE ?? 'quick',
    strixModel: env.STRIX_LLM ?? 'anthropic/claude-sonnet-4-6',
    strixTimeoutSeconds: num(env.STRIX_TIMEOUT_SECONDS, 900),
    strixRunsDir: env.STRIX_RUNS_DIR ?? './strix_runs',
    prebakedReportPath: env.PREBAKED_REPORT_PATH ?? './reports/prebaked-juice-shop.json',
    target: env.AUDIT_TARGET ?? 'http://localhost:8899',
    defaultBudgetSol: num(env.BUYER_MAX_SOL, 0.02),
  })
}
