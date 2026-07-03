import { describe, it, expect } from 'vitest'
import { normalizeSeverity, coerceFinding, parseStrixFindings, buildReport } from './parser.js'
import type { Scope } from '@auditmesh/shared'

describe('normalizeSeverity', () => {
  it('passes through known severities', () => {
    expect(normalizeSeverity('critical')).toBe('critical')
    expect(normalizeSeverity('HIGH')).toBe('high')
    expect(normalizeSeverity('info')).toBe('info')
  })

  it('maps common aliases', () => {
    expect(normalizeSeverity('informational')).toBe('info')
    expect(normalizeSeverity('moderate')).toBe('medium')
    expect(normalizeSeverity('severe')).toBe('high')
  })

  it('buckets by CVSS score when the label is missing/unknown', () => {
    expect(normalizeSeverity(undefined, 9.8)).toBe('critical')
    expect(normalizeSeverity('weird', 7.2)).toBe('high')
    expect(normalizeSeverity(null, 5)).toBe('medium')
    expect(normalizeSeverity(null, 2)).toBe('low')
    expect(normalizeSeverity(null, 0)).toBe('info')
  })
})

describe('coerceFinding', () => {
  it('extracts fields through aliases and normalizes severity', () => {
    const f = coerceFinding(
      {
        name: 'Reflected XSS in search',
        risk: 'high',
        url: '/#/search?q=',
        proof_of_concept: '<script>alert(1)</script> reflected unescaped',
        recommendation: 'Encode output; add CSP.',
        cwe_id: 'CWE-79',
        tags: ['xss'],
      },
      0,
    )
    expect(f).not.toBeNull()
    expect(f!.title).toBe('Reflected XSS in search')
    expect(f!.severity).toBe('high')
    expect(f!.affectedComponent).toBe('/#/search?q=')
    expect(f!.remediation).toMatch(/CSP/)
    expect(f!.cwe).toBe('CWE-79')
    expect(f!.tags).toContain('xss')
  })

  it('attaches a CVSS 3.1 vector when score+vector are present', () => {
    const f = coerceFinding(
      {
        title: 'SQL injection',
        cvss_score: 9.1,
        cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        description: 'error-based sqli',
        remediation: 'parameterize queries',
      },
      1,
    )
    expect(f!.cvss?.baseScore).toBeCloseTo(9.1)
    expect(f!.severity).toBe('critical')
  })

  it('returns null for an entry with no usable title', () => {
    expect(coerceFinding({ severity: 'high' }, 0)).toBeNull()
    expect(coerceFinding('not an object', 0)).toBeNull()
  })

  it('supplies a default remediation and component when absent', () => {
    const f = coerceFinding({ title: 'Missing HSTS' }, 0)
    expect(f!.remediation).toBeTruthy()
    expect(f!.affectedComponent).toBe('unspecified')
  })
})

describe('coerceFinding — real Strix vulnerabilities.json shape', () => {
  // The exact field shape Strix emits (verified against a live run against Juice Shop).
  const strixEntry = {
    id: 'vuln-0001',
    title: 'SQL Injection in Login Endpoint Leading to Authentication Bypass',
    severity: 'critical',
    description: 'The /rest/user/login endpoint is vulnerable to SQL injection.',
    technical_analysis: 'The login endpoint does not parameterize the email input.',
    remediation_steps: '1. Use parameterized queries\n2. Use Sequelize parameterized syntax',
    cvss: 9.8,
    cvss_breakdown: {
      attack_vector: 'N', attack_complexity: 'L', privileges_required: 'N', user_interaction: 'N',
      scope: 'U', confidentiality: 'H', integrity: 'H', availability: 'H',
    },
    endpoint: '/rest/user/login',
    method: 'POST',
    cwe: 'CWE-89',
  }

  it('maps remediation_steps, synthesizes the CVSS vector from cvss_breakdown, and keeps the endpoint', () => {
    const f = coerceFinding(strixEntry, 0)!
    expect(f.severity).toBe('critical')
    expect(f.remediation).toMatch(/parameterized queries/)
    expect(f.remediation).not.toMatch(/best practice/) // not the generic fallback
    expect(f.cvss?.baseScore).toBeCloseTo(9.8)
    expect(f.cvss?.vector).toBe('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')
    expect(f.affectedComponent).toBe('/rest/user/login')
    expect(f.cwe).toBe('CWE-89')
  })

  it('omits CVSS when the breakdown is incomplete (no malformed vector)', () => {
    const f = coerceFinding({ ...strixEntry, cvss_breakdown: { attack_vector: 'N' } }, 0)!
    expect(f.cvss).toBeUndefined()
  })
})

describe('parseStrixFindings', () => {
  it('finds the array under various container keys', () => {
    expect(parseStrixFindings({ findings: [{ title: 'a' }] })).toHaveLength(1)
    expect(parseStrixFindings({ vulnerabilities: [{ title: 'a' }, { title: 'b' }] })).toHaveLength(2)
    expect(parseStrixFindings([{ title: 'x' }])).toHaveLength(1)
    expect(parseStrixFindings({ report: { results: [{ name: 'y' }] } })).toHaveLength(1)
  })

  it('renumbers auto-generated ids contiguously and drops junk entries', () => {
    const fs = parseStrixFindings({ findings: [{ title: 'a' }, { nope: 1 }, { title: 'b' }] })
    expect(fs.map((f) => f.id)).toEqual(['AM-001', 'AM-002'])
  })

  it('returns [] for output with no findings array (a clean scan)', () => {
    expect(parseStrixFindings({ meta: { scanned: true } })).toEqual([])
  })
})

describe('buildReport', () => {
  const scope: Scope = {
    categories: ['xss', 'injection'],
    exclusions: [],
    maxDepth: 3,
    maxDurationSeconds: 900,
    nonDestructive: true,
  }

  it('sorts findings worst-first and computes a consistent summary', () => {
    const findings = parseStrixFindings({
      findings: [
        { title: 'low thing', severity: 'low' },
        { title: 'crit thing', severity: 'critical' },
        { title: 'med thing', severity: 'medium' },
      ],
    })
    const report = buildReport({
      findings,
      target: 'http://localhost:8899',
      grantedScope: scope,
      provenance: { source: 'live', engine: 'strix', scanMode: 'quick' },
      correlationId: 'deal-1',
      generatedAt: '2026-07-02T12:00:00.000Z',
    })
    expect(report.findings[0].severity).toBe('critical')
    expect(report.summary.totalFindings).toBe(3)
    expect(report.summary.highestSeverity).toBe('critical')
  })
})
