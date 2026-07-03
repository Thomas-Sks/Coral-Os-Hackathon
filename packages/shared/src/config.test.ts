import { describe, it, expect } from 'vitest'
import { isAllowlisted, normalizeTarget, loadAuditMeshConfig, TARGET_ALLOWLIST } from './config.js'

describe('target allowlist — the hard boundary', () => {
  it('accepts every bundled allowlist entry', () => {
    for (const entry of TARGET_ALLOWLIST) expect(isAllowlisted(entry)).toBe(true)
  })

  it('accepts an allowlisted origin regardless of path/case/trailing slash', () => {
    expect(isAllowlisted('http://localhost:8899/')).toBe(true)
    expect(isAllowlisted('http://LOCALHOST:8899/rest/products')).toBe(true)
    expect(isAllowlisted('http://juice-shop:3000/#/search')).toBe(true)
  })

  it('rejects arbitrary external hosts', () => {
    expect(isAllowlisted('http://example.com')).toBe(false)
    expect(isAllowlisted('https://victim.internal:8899')).toBe(false)
    expect(isAllowlisted('http://localhost:9999')).toBe(false)
  })

  it('rejects credential-embedding and confusable bypass attempts', () => {
    expect(isAllowlisted('http://localhost:8899@evil.com')).toBe(false)
    expect(isAllowlisted('http://evil.com#@localhost:8899')).toBe(false)
    expect(isAllowlisted('http://localhost:8899.evil.com')).toBe(false)
    expect(isAllowlisted('file:///etc/passwd')).toBe(false)
    expect(isAllowlisted('not a url')).toBe(false)
  })

  it('normalizeTarget returns null for non-http and credentialed URLs', () => {
    expect(normalizeTarget('ftp://localhost:8899')).toBeNull()
    expect(normalizeTarget('http://user:pass@localhost:8899')).toBeNull()
    expect(normalizeTarget('http://localhost:8899')).toBe('http://localhost:8899')
  })
})

describe('loadAuditMeshConfig', () => {
  it('produces demo-safe defaults from an empty env', () => {
    const cfg = loadAuditMeshConfig({})
    expect(cfg.reportSource).toBe('prebaked')
    expect(cfg.scanMode).toBe('quick')
    expect(isAllowlisted(cfg.target)).toBe(true)
    expect(cfg.defaultBudgetSol).toBeGreaterThan(0)
  })

  it('reads and validates overrides', () => {
    const cfg = loadAuditMeshConfig({
      REPORT_SOURCE: 'live',
      SCAN_MODE: 'standard',
      STRIX_TIMEOUT_SECONDS: '600',
      AUDIT_TARGET: 'http://juice-shop:3000',
      BUYER_MAX_SOL: '0.05',
    })
    expect(cfg.reportSource).toBe('live')
    expect(cfg.scanMode).toBe('standard')
    expect(cfg.strixTimeoutSeconds).toBe(600)
    expect(cfg.target).toBe('http://juice-shop:3000')
    expect(cfg.defaultBudgetSol).toBeCloseTo(0.05)
  })

  it('refuses a non-allowlisted target', () => {
    expect(() => loadAuditMeshConfig({ AUDIT_TARGET: 'http://example.com' })).toThrow()
  })
})
