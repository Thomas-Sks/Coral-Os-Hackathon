/**
 * The vulnerability report — the paid artifact.
 *
 * `deliverService()` returns a canonical JSON serialization of an {@link AuditReport}; that string
 * IS the deliverable the escrow releases payment for. The dashboard parses it back and renders it
 * as the findings panel. Because money changes hands over this object, its shape is a hard contract:
 * validated on write (the seller) and on read (the buyer / dashboard) with the same zod schema.
 *
 * The findings themselves are produced by the delegated engine (Strix) against the bundled,
 * authorized target. This module only *describes and validates* that output — it contains no
 * exploitation logic.
 */

import { z } from 'zod'
import { Scope } from './scope.js'

/** Ordered severities. Index doubles as sort weight (higher = worse). */
export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const
export const Severity = z.enum(SEVERITIES)
export type Severity = z.infer<typeof Severity>

/** Numeric rank for sorting/aggregation. critical=4 … info=0. */
export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s)

/** Accent tokens the dashboard maps to muted severity colors (see styles.css). */
export const SEVERITY_ORDER_DESC: Severity[] = [...SEVERITIES].reverse()

/**
 * CVSS v3.1 vector + base score. Optional because not every finding (e.g. an informational
 * header note) warrants a CVSS vector; when present it is surfaced verbatim in the report panel.
 */
export const Cvss = z
  .object({
    version: z.literal('3.1').default('3.1'),
    baseScore: z.number().min(0).max(10),
    vector: z.string().regex(/^CVSS:3\.1\//, 'must be a CVSS:3.1 vector string'),
  })
  .strict()
export type Cvss = z.infer<typeof Cvss>

export const Finding = z
  .object({
    /** Stable within a report (e.g. "AM-001"); lets the UI anchor and the buyer reference it. */
    id: z.string().min(1),
    title: z.string().min(1),
    severity: Severity,
    cvss: Cvss.optional(),
    /** CWE identifier if the engine classified it, e.g. "CWE-79". */
    cwe: z.string().optional(),
    /** Which part of the target the finding concerns (route, header, component, endpoint). */
    affectedComponent: z.string().min(1),
    /**
     * A short, redacted evidence excerpt (a response header, a snippet) — enough to justify the
     * finding, never a weaponized payload. The parser truncates long excerpts.
     */
    evidence: z.string().default(''),
    /** Actionable fix guidance. The thing that makes the report worth paying for. */
    remediation: z.string().min(1),
    /** Free-form tags/categories the engine emitted (maps loosely to Scope categories). */
    tags: z.array(z.string()).default([]),
  })
  .strict()
export type Finding = z.infer<typeof Finding>

/** Aggregate counts + a one-line headline the dashboard shows above the findings list. */
export const ReportSummary = z
  .object({
    totalFindings: z.number().int().min(0),
    bySeverity: z.record(Severity, z.number().int().min(0)),
    /** Worst severity present, or 'info' if clean. Drives the report panel's headline accent. */
    highestSeverity: Severity,
    headline: z.string().min(1),
  })
  .strict()
export type ReportSummary = z.infer<typeof ReportSummary>

/** How the report was produced — provenance the buyer can audit. */
export const ReportProvenance = z
  .object({
    /** 'live' = a fresh Strix run; 'prebaked' = a previously-generated real Strix report replayed. */
    source: z.enum(['live', 'prebaked']),
    engine: z.string().default('strix'),
    engineModel: z.string().optional(),
    scanMode: z.enum(['quick', 'standard', 'deep']).default('quick'),
    /** The Strix run directory name, for traceability back to raw logs. */
    runName: z.string().optional(),
    durationSeconds: z.number().min(0).optional(),
  })
  .strict()
export type ReportProvenance = z.infer<typeof ReportProvenance>

export const AuditReport = z
  .object({
    schemaVersion: z.literal(1).default(1),
    /** Correlates the report with its deal, authorization, and on-chain reference. */
    correlationId: z.string().min(1),
    /** The exact allowlisted target assessed (host the authorization was granted for). */
    target: z.string().min(1),
    /** ISO-8601. Passed in by the caller — the runtime forbids Date.now() in some contexts. */
    generatedAt: z.string().min(1),
    /** The scope actually granted and honored — echoes the signed authorization. */
    grantedScope: Scope,
    provenance: ReportProvenance,
    findings: z.array(Finding),
    summary: ReportSummary,
  })
  .strict()
export type AuditReport = z.infer<typeof AuditReport>

/**
 * Derive the summary from a findings list. Pure. Called by the parser after it maps raw Strix
 * output into {@link Finding}s so the summary is always consistent with the findings it describes.
 */
export function summarize(findings: Finding[]): ReportSummary {
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>
  for (const f of findings) bySeverity[f.severity]++

  const highestSeverity =
    SEVERITY_ORDER_DESC.find((s) => bySeverity[s] > 0) ?? ('info' as Severity)

  const total = findings.length
  const crit = bySeverity.critical
  const high = bySeverity.high
  const headline =
    total === 0
      ? 'No issues surfaced within the granted scope.'
      : `${total} finding${total === 1 ? '' : 's'}` +
        (crit + high > 0 ? ` — ${crit} critical, ${high} high` : ` — highest ${highestSeverity}`)

  return { totalFindings: total, bySeverity, highestSeverity, headline }
}

/**
 * Serialize a report to the canonical deliverable string (stable key order via the schema).
 * Validates before emitting so a malformed report can never be sold.
 */
export function serializeReport(report: AuditReport): string {
  return JSON.stringify(AuditReport.parse(report))
}

/**
 * Parse + validate a deliverable string back into an {@link AuditReport}. Used by the buyer's
 * decision-to-pay and by the dashboard. Throws a zod error on any contract violation.
 */
export function parseReport(serialized: string): AuditReport {
  return AuditReport.parse(JSON.parse(serialized))
}

/** Non-throwing variant for the dashboard, which must render partial/garbage payloads gracefully. */
export function safeParseReport(
  serialized: string,
): { ok: true; report: AuditReport } | { ok: false; error: string } {
  try {
    return { ok: true, report: parseReport(serialized) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
