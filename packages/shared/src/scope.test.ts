import { describe, it, expect } from 'vitest'
import {
  checkScopeWithinPolicy,
  DEFAULT_SCOPE_POLICY,
  Scope,
  type Scope as ScopeT,
  type ScopePolicy,
} from './scope.js'

const scope = (over: Partial<ScopeT> = {}): ScopeT =>
  Scope.parse({ categories: ['security-headers'], ...over })

describe('checkScopeWithinPolicy', () => {
  it('passes a scope within the default policy', () => {
    expect(checkScopeWithinPolicy(scope(), DEFAULT_SCOPE_POLICY)).toEqual([])
  })

  it('flags a category the policy does not permit', () => {
    const policy: ScopePolicy = {
      allowedCategories: ['tls-config'],
      maxDepth: 5,
      maxDurationSeconds: 1200,
      requireNonDestructive: true,
    }
    const v = checkScopeWithinPolicy(scope({ categories: ['tls-config', 'injection'] }), policy)
    expect(v).toHaveLength(1)
    expect(v[0].field).toBe('categories')
    expect(v[0].detail).toMatch(/injection/)
  })

  it('flags depth and duration over the ceiling, and destructive intent', () => {
    const policy: ScopePolicy = {
      allowedCategories: ['injection'],
      maxDepth: 2,
      maxDurationSeconds: 60,
      requireNonDestructive: true,
    }
    const v = checkScopeWithinPolicy(
      scope({ categories: ['injection'], maxDepth: 5, maxDurationSeconds: 900, nonDestructive: false }),
      policy,
    )
    const fields = v.map((x) => x.field).sort()
    expect(fields).toEqual(['maxDepth', 'maxDurationSeconds', 'nonDestructive'])
  })

  it('applies schema defaults (depth 3, non-destructive, empty exclusions)', () => {
    const s = scope()
    expect(s.maxDepth).toBe(3)
    expect(s.nonDestructive).toBe(true)
    expect(s.exclusions).toEqual([])
  })

  it('rejects an empty category list at the schema boundary', () => {
    expect(() => Scope.parse({ categories: [] })).toThrow()
  })
})
