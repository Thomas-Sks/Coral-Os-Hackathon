// Generate reports/prebaked-juice-shop.json — the report served in REPORT_SOURCE=prebaked mode.
//
// The findings below are genuine, publicly-documented OWASP Juice Shop weaknesses (Juice Shop is a
// deliberately-vulnerable teaching app). This file is a *captured* assessment used to keep a filmed
// 3-minute demo deterministic; REPORT_SOURCE=live re-runs Strix against the same target for a fresh
// one. Settlement is always live on devnet regardless of source. Evidence excerpts are short and
// remediation-focused — this is a report, not weaponized tooling.
//
// Run:  node reports/generate-prebaked.mjs
// It builds + validates the report through the real @auditmesh/shared schema so it can never drift.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const { AuditReport, summarize } = await import(
  join(here, '..', 'packages', 'shared', 'dist', 'index.js')
)

const grantedScope = {
  categories: [
    'security-headers',
    'tls-config',
    'injection',
    'xss',
    'access-control',
    'sensitive-data',
    'dependency',
  ],
  exclusions: ['/#/administration', '/api/Feedbacks (destructive delete)'],
  maxDepth: 3,
  maxDurationSeconds: 900,
  nonDestructive: true,
}

const findings = [
  {
    id: 'AM-001',
    title: 'SQL injection in the login endpoint allows authentication bypass',
    severity: 'critical',
    cvss: { version: '3.1', baseScore: 9.8, vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
    cwe: 'CWE-89',
    affectedComponent: 'POST /rest/user/login (email field)',
    evidence:
      'A boolean tautology supplied in the email field returns a valid session for the first user without a matching password — the query is built by string concatenation, not parameterized.',
    remediation:
      'Use parameterized queries / an ORM binding for all user-supplied input. Never concatenate request data into SQL. Add input validation and a WAF rule as defense in depth.',
    tags: ['injection', 'sqli'],
  },
  {
    id: 'AM-002',
    title: 'Reflected/DOM cross-site scripting in the product search',
    severity: 'high',
    cvss: { version: '3.1', baseScore: 7.4, vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:L/A:N' },
    cwe: 'CWE-79',
    affectedComponent: 'GET /#/search?q= (search parameter)',
    evidence:
      'The search term is rendered into the DOM without contextual output encoding, so markup in the query executes in the victim’s browser.',
    remediation:
      'Contextually encode all untrusted output, prefer framework auto-escaping, and deploy a restrictive Content-Security-Policy to blunt injection impact.',
    tags: ['xss'],
  },
  {
    id: 'AM-003',
    title: 'Broken object-level authorization (IDOR) on baskets',
    severity: 'high',
    cvss: { version: '3.1', baseScore: 7.1, vector: 'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:L/A:N' },
    cwe: 'CWE-639',
    affectedComponent: 'GET /rest/basket/{id}',
    evidence:
      'Changing the numeric basket id in the request returns another user’s basket; the endpoint authorizes on authentication but not on ownership of the referenced object.',
    remediation:
      'Enforce per-object authorization on every request: verify the authenticated principal owns (or may access) the referenced resource server-side.',
    tags: ['access-control', 'idor'],
  },
  {
    id: 'AM-004',
    title: 'Sensitive files exposed under the static /ftp directory',
    severity: 'high',
    cwe: 'CWE-538',
    affectedComponent: 'GET /ftp/',
    evidence:
      'The /ftp path lists downloadable files including backups and documents; some are reachable via path/extension tricks that bypass the naive download filter.',
    remediation:
      'Do not serve internal/backup files from a web-reachable directory. Remove the listing, restrict access, and store artifacts outside the web root.',
    tags: ['sensitive-data'],
  },
  {
    id: 'AM-005',
    title: 'Authentication token cookie lacks HttpOnly and Secure flags',
    severity: 'medium',
    cvss: { version: '3.1', baseScore: 5.4, vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N' },
    cwe: 'CWE-1004',
    affectedComponent: 'Set-Cookie: token (login response)',
    evidence:
      'The session token is set without HttpOnly (readable by script, widening XSS impact) and without Secure (transmittable over cleartext).',
    remediation:
      'Set HttpOnly, Secure, and SameSite=strict/lax on session cookies; serve exclusively over HTTPS.',
    tags: ['auth', 'security-headers'],
  },
  {
    id: 'AM-006',
    title: 'Missing Content-Security-Policy header',
    severity: 'medium',
    cwe: 'CWE-693',
    affectedComponent: 'GET / (all responses)',
    evidence:
      'Responses omit a Content-Security-Policy header, so there is no browser-enforced restriction on script sources — any injected script executes freely.',
    remediation:
      'Deploy a strict CSP (default-src \'self\'; disallow inline script; enumerate trusted origins) and iterate with report-only mode.',
    tags: ['security-headers'],
  },
  {
    id: 'AM-007',
    title: 'Outdated front-end dependencies with known vulnerabilities',
    severity: 'medium',
    cwe: 'CWE-1035',
    affectedComponent: 'Bundled JavaScript libraries',
    evidence:
      'Several shipped libraries are pinned to versions with published advisories (prototype pollution / ReDoS class issues).',
    remediation:
      'Upgrade flagged dependencies, add automated dependency scanning to CI, and track a Software Bill of Materials.',
    tags: ['dependency'],
  },
  {
    id: 'AM-008',
    title: 'HTTP Strict-Transport-Security not enforced',
    severity: 'low',
    cwe: 'CWE-319',
    affectedComponent: 'Response headers (transport)',
    evidence:
      'No Strict-Transport-Security header is present, so a downgrade to cleartext HTTP is not prevented on subsequent visits.',
    remediation:
      'Serve over HTTPS and send Strict-Transport-Security with a long max-age (and preload once validated).',
    tags: ['tls-config', 'security-headers'],
  },
  {
    id: 'AM-009',
    title: 'Clickjacking possible — no framing protection',
    severity: 'low',
    cwe: 'CWE-1021',
    affectedComponent: 'Response headers (X-Frame-Options / CSP frame-ancestors)',
    evidence:
      'Neither X-Frame-Options nor a CSP frame-ancestors directive is set, so the application can be embedded in a hostile frame.',
    remediation:
      'Set frame-ancestors \'self\' in CSP (and/or X-Frame-Options: DENY) on all responses.',
    tags: ['security-headers'],
  },
  {
    id: 'AM-010',
    title: 'Verbose error responses disclose stack traces',
    severity: 'low',
    cwe: 'CWE-209',
    affectedComponent: 'Various API error paths',
    evidence:
      'Malformed requests return framework stack traces and internal paths, aiding an attacker’s mapping of the backend.',
    remediation:
      'Return generic error messages to clients; log detail server-side only. Disable debug output in production builds.',
    tags: ['sensitive-data'],
  },
]

const report = {
  schemaVersion: 1,
  correlationId: 'prebaked-seed',
  target: 'http://localhost:8899',
  generatedAt: '2026-07-02T10:15:00.000Z',
  grantedScope,
  provenance: {
    source: 'prebaked',
    engine: 'strix',
    engineModel: 'anthropic/claude-sonnet-4-6',
    scanMode: 'quick',
    runName: 'juice-shop-quick-2026-07-02',
    durationSeconds: 512,
  },
  findings,
  summary: summarize(findings),
}

// Validate through the real schema before writing — this can never produce an invalid report.
const validated = AuditReport.parse(report)
const outPath = join(here, 'prebaked-juice-shop.json')
writeFileSync(outPath, JSON.stringify(validated, null, 2) + '\n')
console.log(
  `wrote ${outPath} — ${validated.findings.length} findings, highest ${validated.summary.highestSeverity}`,
)
