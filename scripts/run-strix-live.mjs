// Run a REAL Strix assessment against the bundled target and parse it into the AuditMesh report
// schema — exercising the actual live pipeline (buildInstruction → runStrix → readStrixRun →
// buildReport). Produces reports/live-report.json, and (if it found anything) refreshes the prebaked
// report used by the demo.
//
// Requires: Docker (Strix runs its own sandbox), the target up (docker-compose.target.yml), and an
// LLM key in .env (LLM_API_KEY / DEEPSEEK_API_KEY + STRIX_LLM). Run under the docker group:
//   sg docker -c 'node scripts/run-strix-live.mjs'
//
// The Strix sandbox reaches the host-published front-door via the docker bridge gateway; override with
// STRIX_TARGET if your gateway differs. The saved report's `target` is the canonical allowlisted origin.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Load .env into process.env so the Strix subprocess inherits the LLM key(s).
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
// Put the venv's `strix` on PATH so runStrix can spawn it.
process.env.PATH = `${join(ROOT, '.venv-strix', 'bin')}:${process.env.PATH}`

const { buildInstruction, runStrix, readStrixRun, buildReport } = await import(
  join(ROOT, 'packages/audit-service/dist/index.js')
)
const { Scope } = await import(join(ROOT, 'packages/shared/dist/index.js'))

// Canonical allowlisted origin recorded in the report; the reachable URL Strix actually connects to.
const CANONICAL_TARGET = 'http://localhost:8899'
const STRIX_TARGET = process.env.STRIX_TARGET || 'http://172.17.0.1:8899'
const MODEL = process.env.STRIX_LLM || 'deepseek/deepseek-chat'
const CORRELATION = `live-${process.env.AUTHZ_NONCE?.slice(0, 8) || 'run'}`
const nowIso = new Date().toISOString()

const scope = Scope.parse({
  categories: ['security-headers', 'tls-config', 'injection', 'xss', 'access-control', 'sensitive-data'],
  exclusions: ['/#/administration'],
  maxDepth: 2,
  maxDurationSeconds: Number(process.env.STRIX_TIMEOUT_SECONDS || 1800),
})

const instruction = buildInstruction({ target: CANONICAL_TARGET, scope, correlationId: CORRELATION })
const instrDir = join(tmpdir(), `auditmesh-live-${Date.now()}`)
mkdirSync(instrDir, { recursive: true })
const instructionPath = join(instrDir, 'instruction.md')
writeFileSync(instructionPath, instruction)

console.log(`\n▶ Strix live scan`)
console.log(`  model:   ${MODEL}`)
console.log(`  target:  ${STRIX_TARGET}  (recorded as ${CANONICAL_TARGET})`)
console.log(`  scope:   ${scope.categories.join(', ')}`)
console.log(`  timeout: ${scope.maxDurationSeconds}s`)
console.log(`  instruction: ${instructionPath}\n`)

// Live status file the dashboard polls, so it can show "the agent is running a pentest" during the scan.
const STATUS = join(ROOT, '.scan-status.json')
const START = Date.now()
const writeStatus = (o) => { try { writeFileSync(STATUS, JSON.stringify({ updatedAt: Date.now(), ...o })) } catch { /* best effort */ } }
writeStatus({ running: true, startedAt: START, target: CANONICAL_TARGET, scope: scope.categories, activity: 'starting Strix sandbox…' })

const result = await runStrix({
  target: STRIX_TARGET,
  scanMode: 'quick',
  instructionPath,
  model: MODEL,
  llmApiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  timeoutSeconds: Number(process.env.STRIX_TIMEOUT_SECONDS || 1800),
  workingDir: ROOT,
  onLine: (line) => {
    process.stdout.write(`  strix│ ${line}\n`)
    const clean = line.replace(/[│╭╮╰╯─]/g, '').trim()
    if (clean.length > 3) writeStatus({ running: true, startedAt: START, target: CANONICAL_TARGET, scope: scope.categories, activity: clean.slice(0, 160) })
  },
})

if (!result.ok) {
  writeStatus({ running: false, done: true, error: `${result.code}: ${result.reason}`, target: CANONICAL_TARGET })
  console.error(`\n✗ Strix run failed: ${result.code} — ${result.reason}`)
  process.exit(1)
}
console.log(`\n✓ Strix run complete (exit ${result.exitCode}) — run dir: ${result.runDir}`)

const parsed = await readStrixRun(result.runDir)
console.log(`  parsed ${parsed.findings.length} finding(s) from ${parsed.sourceFile ?? '(no JSON report; markdown/logs only)'}`)

const report = buildReport({
  findings: parsed.findings,
  target: CANONICAL_TARGET,
  grantedScope: scope,
  provenance: {
    source: 'live',
    engine: 'strix',
    engineModel: MODEL,
    scanMode: 'quick',
    runName: parsed.runName,
  },
  correlationId: CORRELATION,
  generatedAt: nowIso,
})

mkdirSync(join(ROOT, 'reports'), { recursive: true })
const livePath = join(ROOT, 'reports', 'live-report.json')
writeFileSync(livePath, JSON.stringify(report, null, 2) + '\n')
console.log(`\n✓ wrote ${livePath}`)
console.log(`  ${report.summary.headline} — highest severity: ${report.summary.highestSeverity}`)

// If the live scan produced findings, refresh the prebaked report so the demo shows a real run.
if (report.findings.length > 0) {
  const prebaked = { ...report, provenance: { ...report.provenance, source: 'prebaked' }, correlationId: 'prebaked-seed' }
  writeFileSync(join(ROOT, 'reports', 'prebaked-juice-shop.json'), JSON.stringify(prebaked, null, 2) + '\n')
  console.log(`✓ refreshed reports/prebaked-juice-shop.json from the live run (${report.findings.length} findings)`)
} else {
  console.log(`  (no findings parsed — left the existing prebaked report untouched; see the run dir for raw output)`)
}

writeStatus({ running: false, done: true, findings: report.findings.length, highestSeverity: report.summary.highestSeverity, runName: parsed.runName, target: CANONICAL_TARGET })
