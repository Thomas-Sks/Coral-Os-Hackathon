// Host-side Strix scan broker.
//
// The winning seller runs inside a coral-spawned container with no Docker-in-Docker, so it can't run
// Strix's sandbox itself. Instead, AFTER it wins and consent is verified, it calls THIS host service
// with the granted scope; the broker runs the real Strix scan (scoped to the offer) on the host and
// returns the findings. So the scan happens after the negotiation and matches the deal.
//
//   npm run scan:broker           # listens on :7070 (SCAN_BROKER_PORT)
//   POST /scan  { target, categories:[…], correlationId, round }  →  { ok, findings, runName }
//
// Requires: the Strix engine (npm run setup:strix) + Docker. Reuses the audit-service scan pipeline.

import { createServer } from 'node:http'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
process.env.PATH = `${join(ROOT, '.venv-strix', 'bin')}:${process.env.PATH}`

const { buildInstruction, runStrix, readStrixRun } = await import(join(ROOT, 'packages/audit-service/dist/index.js'))
const { Scope, isAllowlisted, ALL_TEST_CATEGORIES } = await import(join(ROOT, 'packages/shared/dist/index.js'))

const PORT = Number(process.env.SCAN_BROKER_PORT || 7070)
const MODEL = process.env.STRIX_LLM || 'deepseek/deepseek-chat'
const STATUS = join(ROOT, '.scan-status.json')
const writeStatus = (o) => { try { writeFileSync(STATUS, JSON.stringify({ updatedAt: Date.now(), ...o })) } catch { /* */ } }

let busy = false

// The winning persona's offer sets the scan DEPTH — a real difference, not just a price tag.
const DEPTH = { quick: 2, standard: 3, deep: 5 }

async function runScan({ target, categories, correlationId, round, scanMode }) {
  // Map the offer's categories to a scope (fall back to all if none valid). Strict allowlist on target.
  const cats = (Array.isArray(categories) ? categories : []).filter((c) => ALL_TEST_CATEGORIES.includes(c))
  const mode = ['quick', 'standard', 'deep'].includes(scanMode) ? scanMode : 'quick'
  const scope = Scope.parse({
    categories: cats.length ? cats : [...ALL_TEST_CATEGORIES],
    exclusions: ['/#/administration'],
    maxDepth: DEPTH[mode],
    maxDurationSeconds: Number(process.env.STRIX_TIMEOUT_SECONDS || 1200),
  })
  // The broker is handed an internal/allowlisted target the SELLER verified; assert allowlist here too.
  const strixTarget = process.env.SCAN_BROKER_TARGET || 'http://172.17.0.1:8899'
  const canonical = isAllowlisted(target) ? target : 'http://localhost:8899'

  const start = Date.now()
  writeStatus({ running: true, startedAt: start, round, target: canonical, scope: scope.categories, scanMode: mode, activity: 'starting Strix sandbox…' })

  const instrDir = join(tmpdir(), `auditmesh-broker-${Date.now()}`)
  mkdirSync(instrDir, { recursive: true })
  const instructionPath = join(instrDir, 'instruction.md')
  writeFileSync(instructionPath, buildInstruction({ target: canonical, scope, correlationId }))

  console.error(`[broker] scan round=${round} mode=${mode} depth=${DEPTH[mode]} scope=[${scope.categories.join(',')}] → ${strixTarget}`)
  const result = await runStrix({
    target: strixTarget,
    scanMode: mode,
    instructionPath,
    model: MODEL,
    llmApiKey: process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY || '',
    timeoutSeconds: Number(process.env.STRIX_TIMEOUT_SECONDS || 1200),
    workingDir: ROOT,
    onLine: (line) => {
      const clean = line.replace(/[│╭╮╰╯─]/g, '').trim()
      if (clean.length > 3) writeStatus({ running: true, startedAt: start, round, target: canonical, scope: scope.categories, scanMode: mode, activity: clean.slice(0, 160) })
    },
  })
  if (!result.ok) {
    writeStatus({ running: false, done: true, round, error: `${result.code}: ${result.reason}` })
    throw new Error(`strix ${result.code}: ${result.reason}`)
  }
  const parsed = await readStrixRun(result.runDir)
  // Keep only findings within the granted scope's families (so the report matches the offer).
  const inScope = parsed.findings.filter((f) => {
    const tags = (f.tags || []).map((t) => String(t).toLowerCase())
    return cats.length === 0 || cats.some((c) => tags.includes(c) || tags.includes(c.split('-')[0]))
  })
  const findings = inScope.length ? inScope : parsed.findings // never deliver an empty report if the scan found things
  writeStatus({ running: false, done: true, round, target: canonical, findings: findings.length })
  console.error(`[broker] round=${round} done — ${findings.length}/${parsed.findings.length} findings in scope`)
  return { findings, runName: parsed.runName }
}

createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'GET' && req.url === '/health') { res.end(JSON.stringify({ ok: true, busy })); return }
  if (req.method !== 'POST' || req.url !== '/scan') { res.statusCode = 404; res.end(JSON.stringify({ error: 'POST /scan' })); return }
  if (busy) { res.statusCode = 429; res.end(JSON.stringify({ error: 'a scan is already running' })); return }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', async () => {
    busy = true
    try {
      const out = await runScan(JSON.parse(body || '{}'))
      res.end(JSON.stringify({ ok: true, ...out }))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: e?.message ?? String(e) }))
    } finally {
      busy = false
    }
  })
}).listen(PORT, () => console.error(`[broker] Strix scan broker on :${PORT}  (model ${MODEL})`))
