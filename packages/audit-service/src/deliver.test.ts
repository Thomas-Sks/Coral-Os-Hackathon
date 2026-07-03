import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Keypair } from '@solana/web3.js'
import { loadAuditMeshConfig, parseReport, type DeliveryProgressEvent } from '@auditmesh/shared'
import { issueAuthorization, wellKnownBody, encodeGrant } from '@auditmesh/authorization'
import { runAudit, deliverService } from './deliver.js'
import { buildReport } from './parser.js'

const NOW = Date.parse('2026-07-02T12:00:00.000Z')
const TARGET = 'http://localhost:8899'
const nonce = 'feedface00feedface00feedface0000'

let prebakedPath: string
let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'auditmesh-test-'))
  prebakedPath = path.join(tmpDir, 'prebaked.json')
  const report = buildReport({
    findings: [
      { id: 'AM-001', title: 'Missing CSP', severity: 'medium', affectedComponent: 'GET /', evidence: 'no CSP header', remediation: 'add CSP', tags: ['security-headers'] },
      { id: 'AM-002', title: 'Reflected XSS', severity: 'high', affectedComponent: '/#/search', evidence: '<script>', remediation: 'encode output', tags: ['xss'] },
    ],
    target: TARGET,
    grantedScope: { categories: ['security-headers', 'xss'], exclusions: [], maxDepth: 3, maxDurationSeconds: 900, nonDestructive: true },
    provenance: { source: 'prebaked', engine: 'strix', scanMode: 'quick' },
    correlationId: 'seed',
    generatedAt: new Date(NOW).toISOString(),
  })
  await fs.writeFile(prebakedPath, JSON.stringify(report, null, 2))
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function grant(over: Partial<Parameters<typeof issueAuthorization>[0]> = {}) {
  const signer = Keypair.generate()
  return issueAuthorization({
    signer,
    target: TARGET,
    scope: { categories: ['security-headers', 'xss'] } as never,
    method: 'well-known',
    nonce,
    correlationId: 'deal-e2e',
    ttlSeconds: 3600,
    nowMs: NOW,
    ...over,
  })
}

const servingNonce = async (url: string): Promise<string> => {
  if (url.endsWith('/.well-known/auditmesh-authz.txt')) return wellKnownBody(nonce)
  throw new Error(`unexpected ${url}`)
}

describe('runAudit — prebaked pipeline', () => {
  it('gates on authz, animates the delivery graph, and returns a valid report', async () => {
    const config = loadAuditMeshConfig({ REPORT_SOURCE: 'prebaked', PREBAKED_REPORT_PATH: prebakedPath, AUDIT_TARGET: TARGET })
    const events: DeliveryProgressEvent[] = []
    const result = await runAudit({
      signed: grant(),
      round: 1,
      config,
      nowMs: NOW,
      onProgress: (ev) => { events.push(ev) },
      verifyDeps: { fetchText: servingNonce },
      pacingMs: 0,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // report is valid + re-stamped for this deal
    const report = parseReport(result.serialized)
    expect(report.correlationId).toBe('deal-e2e')
    expect(report.provenance.source).toBe('prebaked')
    expect(report.findings).toHaveLength(2)
    expect(report.findings[0].severity).toBe('high') // sorted worst-first
    // all three stages activated and completed
    const stages = new Set(events.map((e) => e.stage))
    expect(stages).toEqual(new Set(['recon', 'analysis', 'reporting']))
    expect(events.filter((e) => e.status === 'done')).toHaveLength(3)
  })

  it('rejects an expired grant at the authorization gate (no delivery)', async () => {
    const config = loadAuditMeshConfig({ REPORT_SOURCE: 'prebaked', PREBAKED_REPORT_PATH: prebakedPath, AUDIT_TARGET: TARGET })
    const events: DeliveryProgressEvent[] = []
    const result = await runAudit({
      signed: grant({ ttlSeconds: 30 }),
      round: 2,
      config,
      nowMs: NOW + 120_000,
      onProgress: (ev) => { events.push(ev) },
      verifyDeps: { fetchText: servingNonce },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.stage).toBe('authorization')
    expect(result.code).toBe('EXPIRED')
    expect(events).toHaveLength(0) // never entered the delivery graph
  })
})

describe('deliverService — fork-point wrapper', () => {
  it('returns the serialized report string for a valid request', async () => {
    const config = loadAuditMeshConfig({ REPORT_SOURCE: 'prebaked', PREBAKED_REPORT_PATH: prebakedPath, AUDIT_TARGET: TARGET })
    const request = JSON.stringify({ round: 3, grantToken: encodeGrant(grant()), nowMs: NOW })
    const out = await deliverService(request, { config, verifyDeps: { fetchText: servingNonce } })
    const report = parseReport(out)
    expect(report.findings).toHaveLength(2)
  })

  it('returns a JSON error (never throws) for a bad grant token', async () => {
    const config = loadAuditMeshConfig({ REPORT_SOURCE: 'prebaked', PREBAKED_REPORT_PATH: prebakedPath, AUDIT_TARGET: TARGET })
    const request = JSON.stringify({ round: 4, grantToken: 'not-a-valid-token', nowMs: NOW })
    const out = await deliverService(request, { config, verifyDeps: { fetchText: servingNonce } })
    const parsed = JSON.parse(out)
    expect(parsed.error).toBeTruthy()
    expect(parsed.error.stage).toBe('authorization')
  })
})
