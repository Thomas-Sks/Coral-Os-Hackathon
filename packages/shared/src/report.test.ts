import { describe, it, expect } from 'vitest'
import {
  summarize,
  serializeReport,
  parseReport,
  safeParseReport,
  type AuditReport,
  type Finding,
} from './report.js'

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'AM-001',
  title: 'Missing Content-Security-Policy header',
  severity: 'medium',
  affectedComponent: 'GET /',
  evidence: 'Response headers did not include Content-Security-Policy',
  remediation: 'Set a restrictive CSP header.',
  tags: ['security-headers'],
  ...over,
})

const report = (findings: Finding[]): AuditReport => ({
  schemaVersion: 1,
  correlationId: 'deal-abc',
  target: 'http://localhost:8899',
  generatedAt: '2026-07-02T12:00:00.000Z',
  grantedScope: {
    categories: ['security-headers'],
    exclusions: [],
    maxDepth: 3,
    maxDurationSeconds: 900,
    nonDestructive: true,
  },
  provenance: { source: 'prebaked', engine: 'strix', scanMode: 'quick' },
  findings,
  summary: summarize(findings),
})

describe('summarize', () => {
  it('reports a clean scope with no findings', () => {
    const s = summarize([])
    expect(s.totalFindings).toBe(0)
    expect(s.highestSeverity).toBe('info')
    expect(s.headline).toMatch(/no issues/i)
  })

  it('counts by severity and picks the worst as the highlight', () => {
    const s = summarize([
      finding({ id: 'a', severity: 'low' }),
      finding({ id: 'b', severity: 'critical' }),
      finding({ id: 'c', severity: 'high' }),
      finding({ id: 'd', severity: 'high' }),
    ])
    expect(s.totalFindings).toBe(4)
    expect(s.highestSeverity).toBe('critical')
    expect(s.bySeverity.high).toBe(2)
    expect(s.headline).toMatch(/1 critical, 2 high/)
  })
})

describe('serialize / parse round-trip', () => {
  it('round-trips a valid report', () => {
    const r = report([finding(), finding({ id: 'AM-002', severity: 'high' })])
    const back = parseReport(serializeReport(r))
    expect(back).toEqual(r)
  })

  it('rejects a report whose summary the schema cannot validate', () => {
    const bad = { ...report([finding()]), target: '' }
    expect(() => serializeReport(bad as AuditReport)).toThrow()
  })

  it('safeParseReport returns an error result instead of throwing on garbage', () => {
    const res = safeParseReport('{not json')
    expect(res.ok).toBe(false)
  })

  it('safeParseReport accepts a real serialized report', () => {
    const res = safeParseReport(serializeReport(report([finding()])))
    expect(res.ok).toBe(true)
  })
})
