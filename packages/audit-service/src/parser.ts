/**
 * Parse Strix output into the AuditMesh report schema.
 *
 * Strix writes "vulnerability reports in JSON and Markdown" to `strix_runs/<run>/`, but does not
 * document exact filenames or a stable JSON shape, so the parser is deliberately tolerant: it finds
 * the findings array under any of several plausible keys, and coerces each entry's fields through a
 * list of common aliases. A present-but-empty run is a *clean* report (zero findings), not an error.
 *
 * The pure functions here (`parseStrixFindings`, `coerceFinding`, `normalizeSeverity`) take already-
 * parsed JSON so they are fully unit-testable without touching the filesystem; `readStrixRun` (in
 * strix.ts) does the I/O and hands the parsed object here.
 */

import {
  Finding,
  Severity,
  SEVERITIES,
  summarize,
  AuditReport,
  type Scope,
  type ReportProvenance,
} from '@auditmesh/shared'

const EVIDENCE_MAX = 600

/** Field aliases seen across security-tool JSON. First non-empty wins. */
const TITLE_KEYS = ['title', 'name', 'summary', 'vulnerability', 'issue', 'check']
const SEVERITY_KEYS = ['severity', 'risk', 'risk_level', 'level', 'cvss_severity']
const COMPONENT_KEYS = ['affected_component', 'component', 'affected', 'location', 'url', 'endpoint', 'path', 'target']
const EVIDENCE_KEYS = ['evidence', 'proof_of_concept', 'poc', 'technical_analysis', 'description', 'impact', 'poc_description', 'details', 'detail', 'observation']
const REMEDIATION_KEYS = ['remediation', 'remediation_steps', 'remediation_step', 'recommendation', 'fix', 'mitigation', 'solution', 'advice']
const CWE_KEYS = ['cwe', 'cwe_id', 'cweId']
const CVSS_SCORE_KEYS = ['cvss_score', 'cvssScore', 'cvss_base_score', 'baseScore', 'score', 'cvss']
const CVSS_VECTOR_KEYS = ['cvss_vector', 'cvssVector', 'vector']
const ARRAY_KEYS = ['findings', 'vulnerabilities', 'vulns', 'issues', 'results', 'detections']

/** Map any severity-ish string, using a CVSS score as a fallback bucket, to our enum. */
export function normalizeSeverity(input: unknown, cvssScore?: number): Severity {
  if (typeof input === 'string') {
    const s = input.trim().toLowerCase()
    if (SEVERITIES.includes(s as Severity)) return s as Severity
    if (s === 'informational' || s === 'note' || s === 'none') return 'info'
    if (s === 'moderate' || s === 'medium-high') return 'medium'
    if (s === 'severe') return 'high'
  }
  if (typeof cvssScore === 'number' && Number.isFinite(cvssScore)) {
    if (cvssScore >= 9) return 'critical'
    if (cvssScore >= 7) return 'high'
    if (cvssScore >= 4) return 'medium'
    if (cvssScore >= 0.1) return 'low'
  }
  return 'info'
}

function pick(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return undefined
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  }
  return undefined
}

/** CVSS 3.1 metric abbreviations, in canonical vector order, mapped to their breakdown-object keys. */
const CVSS_METRICS: [string, string[]][] = [
  ['AV', ['attack_vector', 'attackVector', 'av']],
  ['AC', ['attack_complexity', 'attackComplexity', 'ac']],
  ['PR', ['privileges_required', 'privilegesRequired', 'pr']],
  ['UI', ['user_interaction', 'userInteraction', 'ui']],
  ['S', ['scope', 's']],
  ['C', ['confidentiality', 'c']],
  ['I', ['integrity', 'i']],
  ['A', ['availability', 'a']],
]

/**
 * Return a CVSS:3.1 vector string: a real one if the finding carries it, else synthesize it from a
 * `cvss_breakdown`-style object (as Strix emits — `{attack_vector:"N", confidentiality:"H", …}`).
 * Returns undefined if neither is available.
 */
function cvssVector(obj: Record<string, unknown>): string | undefined {
  const raw = pick(obj, CVSS_VECTOR_KEYS)
  if (typeof raw === 'string' && raw.startsWith('CVSS:3.1/')) return raw

  const bd = (obj.cvss_breakdown ?? obj.cvssBreakdown ?? obj.cvss_vector_breakdown) as
    | Record<string, unknown>
    | undefined
  if (!bd || typeof bd !== 'object') return undefined

  const parts: string[] = []
  for (const [metric, keys] of CVSS_METRICS) {
    const v = pick(bd, keys)
    if (!v) return undefined // incomplete breakdown → don't emit a malformed vector
    parts.push(`${metric}:${v.toUpperCase()}`)
  }
  return `CVSS:3.1/${parts.join('/')}`
}

/** Coerce one raw entry into a {@link Finding}; returns null if it has no usable title. */
export function coerceFinding(raw: unknown, index: number): Finding | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>

  const title = pick(obj, TITLE_KEYS)
  if (!title) return null

  const cvssScore = pickNumber(obj, CVSS_SCORE_KEYS)
  const vector = cvssVector(obj)
  const severity = normalizeSeverity(pick(obj, SEVERITY_KEYS), cvssScore)

  const evidence = (pick(obj, EVIDENCE_KEYS) ?? '').slice(0, EVIDENCE_MAX)
  const remediation = pick(obj, REMEDIATION_KEYS) ?? 'Review and remediate per current best practice.'
  const affectedComponent = pick(obj, COMPONENT_KEYS) ?? 'unspecified'

  const tags = Array.isArray(obj.tags)
    ? obj.tags.filter((t): t is string => typeof t === 'string')
    : []

  const idFromSource = pick(obj, ['id', 'ref', 'reference_id'])
  const id = idFromSource ?? `AM-${String(index + 1).padStart(3, '0')}`

  const cvss =
    typeof cvssScore === 'number' && vector
      ? { version: '3.1' as const, baseScore: clamp(cvssScore, 0, 10), vector }
      : undefined

  const cwe = pick(obj, CWE_KEYS)

  return Finding.parse({
    id,
    title,
    severity,
    ...(cvss ? { cvss } : {}),
    ...(cwe ? { cwe } : {}),
    affectedComponent,
    evidence,
    remediation,
    tags,
  })
}

/** Locate the findings array in an arbitrary Strix JSON object and coerce each entry. */
export function parseStrixFindings(raw: unknown): Finding[] {
  const arr = findFindingsArray(raw)
  const out: Finding[] = []
  arr.forEach((entry, i) => {
    const f = coerceFinding(entry, out.length + i)
    if (f) out.push(f)
  })
  // Re-index ids that we auto-generated so they are contiguous (AM-001, AM-002, …).
  return out.map((f, i) =>
    f.id.startsWith('AM-') ? { ...f, id: `AM-${String(i + 1).padStart(3, '0')}` } : f,
  )
}

function findFindingsArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    for (const key of ARRAY_KEYS) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[]
    }
    // Some tools nest under a top-level report/result object.
    for (const key of ['report', 'result', 'data']) {
      if (obj[key] && typeof obj[key] === 'object') {
        const nested = findFindingsArray(obj[key])
        if (nested.length > 0) return nested
      }
    }
  }
  return []
}

export interface BuildReportInput {
  findings: Finding[]
  target: string
  grantedScope: Scope
  provenance: ReportProvenance
  correlationId: string
  generatedAt: string
}

/** Assemble a validated {@link AuditReport} from parsed findings + deal metadata. */
export function buildReport(input: BuildReportInput): AuditReport {
  const findings = [...input.findings].sort(
    (a, b) => SEVERITIES.indexOf(b.severity) - SEVERITIES.indexOf(a.severity),
  )
  return AuditReport.parse({
    schemaVersion: 1,
    correlationId: input.correlationId,
    target: input.target,
    generatedAt: input.generatedAt,
    grantedScope: input.grantedScope,
    provenance: input.provenance,
    findings,
    summary: summarize(findings),
  })
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}
