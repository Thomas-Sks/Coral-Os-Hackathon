/**
 * Assessment scope — the rules of engagement.
 *
 * A {@link Scope} is the machine-readable contract for *what a seller is allowed to do* to a
 * target. It is embedded in the buyer's WANT, echoed by a seller's BID, and — critically —
 * signed into the {@link AuthorizationPayload} the buyer grants before any work begins. The
 * seller's `deliverService()` translates the *granted* scope into Strix's rules of engagement,
 * and the verifier rejects any request whose scope exceeds policy.
 *
 * Nothing here is offensive tooling: a Scope only ever *narrows* what the delegated engine may
 * do. There is no field that can widen it beyond the bundled, authorized target.
 */

import { z } from 'zod'

/**
 * Test families a seller may be authorized to run. These map to Strix instruction directives,
 * not to exploit code — they describe *what class of weakness to look for*, not how to weaponize
 * it. Deliberately coarse; policy caps which of these a persona may ever offer.
 */
export const TestCategory = z.enum([
  'tls-config', // TLS/cipher/HSTS/redirect hygiene
  'security-headers', // CSP, X-Frame-Options, cookie flags, etc.
  'injection', // SQLi/NoSQLi/command-injection surface discovery
  'xss', // reflected/stored/DOM cross-site scripting surface
  'auth', // authentication/session/authorization weaknesses
  'access-control', // IDOR / broken object-level authorization
  'sensitive-data', // information disclosure, verbose errors, secrets in responses
  'dependency', // known-vulnerable components / outdated libraries
  'business-logic', // workflow/logic flaws
])
export type TestCategory = z.infer<typeof TestCategory>

export const ALL_TEST_CATEGORIES = TestCategory.options

/** Human labels for the dashboard's scope chips. */
export const TEST_CATEGORY_LABEL: Record<TestCategory, string> = {
  'tls-config': 'TLS Configuration',
  'security-headers': 'Security Headers',
  injection: 'Injection',
  xss: 'Cross-Site Scripting',
  auth: 'Authentication',
  'access-control': 'Access Control',
  'sensitive-data': 'Sensitive Data Exposure',
  dependency: 'Vulnerable Dependencies',
  'business-logic': 'Business Logic',
}

export const Scope = z
  .object({
    /** Test families the seller is permitted to run. Must be non-empty and within persona/policy. */
    categories: z.array(TestCategory).min(1),
    /**
     * Path prefixes the seller MUST NOT touch (honored as Strix exclusions / rules of engagement).
     * Always includes any destructive or account-mutating routes the buyer wants left alone.
     */
    exclusions: z.array(z.string()).default([]),
    /**
     * Crawl/analysis depth cap. 1 = surface only (headers/TLS/landing), 3 = normal, 5 = thorough.
     * Bounds how far the delegated engine may explore; never a license to leave the target.
     */
    maxDepth: z.number().int().min(1).max(5).default(3),
    /** Hard wall-clock cap for the whole assessment, in seconds. Enforced by the Strix wrapper. */
    maxDurationSeconds: z
      .number()
      .int()
      .min(30)
      .max(60 * 60)
      .default(900),
    /** Explicitly forbid any state-changing/exploitation actions (read-only recon). Default true. */
    nonDestructive: z.boolean().default(true),
  })
  .strict()
export type Scope = z.infer<typeof Scope>

/**
 * Policy ceiling every granted scope is checked against. A request that asks for a category
 * outside `allowedCategories`, a depth above `maxDepth`, or a duration above `maxDurationSeconds`
 * is rejected by the verifier before any scan starts. This is a hard boundary, not advice.
 */
/**
 * Compact short codes for encoding a requested scope into a WANT's whitespace-free `arg` token
 * (the starter's market grammar is space-delimited). The buyer encodes the categories it wants
 * assessed; sellers decode to decide whether the job fits their persona. The *authoritative* scope
 * is always the signed authorization — this is only a bidding hint.
 */
export const CATEGORY_SHORT: Record<TestCategory, string> = {
  'tls-config': 'tls',
  'security-headers': 'hdr',
  injection: 'inj',
  xss: 'xss',
  auth: 'auth',
  'access-control': 'ac',
  'sensitive-data': 'data',
  dependency: 'dep',
  'business-logic': 'biz',
}
const SHORT_TO_CATEGORY: Record<string, TestCategory> = Object.fromEntries(
  ALL_TEST_CATEGORIES.map((c) => [CATEGORY_SHORT[c], c]),
) as Record<string, TestCategory>

/** Encode requested categories as `hdr+tls+xss` (stable order, whitespace-free). */
export function encodeScopeArg(categories: TestCategory[]): string {
  const ordered = ALL_TEST_CATEGORIES.filter((c) => categories.includes(c))
  return ordered.map((c) => CATEGORY_SHORT[c]).join('+') || 'hdr'
}

/** Decode a `hdr+tls+xss` arg back to categories, ignoring unknown codes. */
export function decodeScopeArg(arg: string): TestCategory[] {
  return arg
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((code) => SHORT_TO_CATEGORY[code])
    .filter((c): c is TestCategory => Boolean(c))
}

export const ScopePolicy = z
  .object({
    allowedCategories: z.array(TestCategory).min(1),
    maxDepth: z.number().int().min(1).max(5),
    maxDurationSeconds: z.number().int().min(30),
    requireNonDestructive: z.boolean().default(true),
  })
  .strict()
export type ScopePolicy = z.infer<typeof ScopePolicy>

/** A single reason a scope failed policy — surfaced to logs and the dashboard's rejection state. */
export interface ScopeViolation {
  field: 'categories' | 'maxDepth' | 'maxDurationSeconds' | 'nonDestructive'
  detail: string
}

/**
 * Check a granted scope against policy. Pure and total — returns every violation, never throws.
 * The default policy (below) is intentionally conservative; personas may only ever narrow it.
 */
export function checkScopeWithinPolicy(scope: Scope, policy: ScopePolicy): ScopeViolation[] {
  const violations: ScopeViolation[] = []

  const disallowed = scope.categories.filter((c) => !policy.allowedCategories.includes(c))
  if (disallowed.length > 0) {
    violations.push({
      field: 'categories',
      detail: `categories not permitted by policy: ${disallowed.join(', ')}`,
    })
  }
  if (scope.maxDepth > policy.maxDepth) {
    violations.push({
      field: 'maxDepth',
      detail: `depth ${scope.maxDepth} exceeds policy max ${policy.maxDepth}`,
    })
  }
  if (scope.maxDurationSeconds > policy.maxDurationSeconds) {
    violations.push({
      field: 'maxDurationSeconds',
      detail: `duration ${scope.maxDurationSeconds}s exceeds policy max ${policy.maxDurationSeconds}s`,
    })
  }
  if (policy.requireNonDestructive && !scope.nonDestructive) {
    violations.push({
      field: 'nonDestructive',
      detail: 'policy requires non-destructive (read-only) assessment',
    })
  }
  return violations
}

/**
 * The conservative default policy for the bundled demo: read-only, every category permitted but
 * capped at moderate depth and a 20-minute wall clock. Real deployments would tighten this per
 * target. It exists so the boundary is enforced even if a persona forgets to declare one.
 */
export const DEFAULT_SCOPE_POLICY: ScopePolicy = {
  allowedCategories: [...ALL_TEST_CATEGORIES],
  maxDepth: 5,
  maxDurationSeconds: 20 * 60,
  requireNonDestructive: true,
}
