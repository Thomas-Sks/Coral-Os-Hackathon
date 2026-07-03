import { describe, it, expect } from 'vitest'
import { buildInstruction } from './instruction.js'
import type { Scope } from '@auditmesh/shared'

const scope: Scope = {
  categories: ['tls-config', 'security-headers'],
  exclusions: ['/admin', '/#/administration'],
  maxDepth: 2,
  maxDurationSeconds: 600,
  nonDestructive: true,
}

describe('buildInstruction — rules of engagement', () => {
  const md = buildInstruction({ target: 'http://localhost:8899', scope, correlationId: 'deal-42' })

  it('pins the single target and the correlation id', () => {
    expect(md).toContain('http://localhost:8899')
    expect(md).toContain('deal-42')
    expect(md).toMatch(/ONLY host in scope/i)
  })

  it('lists the granted categories and honored exclusions', () => {
    expect(md).toContain('TLS Configuration')
    expect(md).toContain('Security Headers')
    expect(md).toContain('/admin')
    expect(md).toContain('/#/administration')
  })

  it('states the non-destructive constraint and the off-target prohibition', () => {
    expect(md).toMatch(/NON-DESTRUCTIVE/i)
    expect(md).toMatch(/Any host other than the target/i)
  })

  it('is deterministic for a given (target, scope)', () => {
    const again = buildInstruction({ target: 'http://localhost:8899', scope, correlationId: 'deal-42' })
    expect(again).toBe(md)
  })
})
