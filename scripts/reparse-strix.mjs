// Re-parse an EXISTING Strix run directory into the AuditMesh report schema — no re-scan.
// Useful after a parser improvement, or to regenerate reports from a captured run.
//   node scripts/reparse-strix.mjs strix_runs/<run-dir>

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const { readStrixRun, buildReport } = await import(join(ROOT, 'packages/audit-service/dist/index.js'))
const { Scope } = await import(join(ROOT, 'packages/shared/dist/index.js'))

const runDir = process.argv[2] || 'strix_runs'
const scope = Scope.parse({
  categories: ['security-headers', 'tls-config', 'injection', 'xss', 'access-control', 'sensitive-data'],
  exclusions: ['/#/administration'],
  maxDepth: 2,
})

const parsed = await readStrixRun(join(ROOT, runDir))
const report = buildReport({
  findings: parsed.findings,
  target: 'http://localhost:8899',
  grantedScope: scope,
  provenance: { source: 'live', engine: 'strix', engineModel: process.env.STRIX_LLM || 'deepseek/deepseek-chat', scanMode: 'quick', runName: parsed.runName || basename(runDir) },
  correlationId: `live-${basename(runDir)}`,
  generatedAt: new Date().toISOString(),
})

writeFileSync(join(ROOT, 'reports/live-report.json'), JSON.stringify(report, null, 2) + '\n')
if (report.findings.length > 0) {
  const prebaked = { ...report, provenance: { ...report.provenance, source: 'prebaked' }, correlationId: 'prebaked-seed' }
  writeFileSync(join(ROOT, 'reports/prebaked-juice-shop.json'), JSON.stringify(prebaked, null, 2) + '\n')
}
console.log(`re-parsed ${parsed.findings.length} findings from ${parsed.sourceFile || runDir}`)
console.log(`  ${report.summary.headline}; withCVSS=${report.findings.filter(f => f.cvss).length}/${report.findings.length}, genericRemediation=${report.findings.filter(f => /best practice/.test(f.remediation)).length}`)
