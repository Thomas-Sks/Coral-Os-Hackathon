/**
 * Build Strix's `instruction.md` from the granted scope.
 *
 * The instruction file IS the rules of engagement handed to the delegated engine: it restates the
 * *authorized* scope (categories, depth, exclusions, non-destructive), pins the single allowlisted
 * target, and forbids anything outside it. We author no exploit logic here — only the boundaries the
 * engine must stay within. The seller writes this file and passes it to `strix --instruction-file`.
 */

import {
  TEST_CATEGORY_LABEL,
  type Scope,
} from '@auditmesh/shared'

export interface InstructionInput {
  /** The single allowlisted target origin. */
  target: string
  /** The scope actually granted and verified. */
  scope: Scope
  /** Correlates the run with its deal + report. */
  correlationId: string
}

/**
 * Render the instruction markdown. Deterministic (no timestamps) so a given (target, scope) always
 * produces byte-identical rules of engagement — auditable, and stable for tests.
 */
export function buildInstruction(input: InstructionInput): string {
  const { target, scope, correlationId } = input
  const categories = scope.categories.map((c) => `- ${TEST_CATEGORY_LABEL[c]} (\`${c}\`)`).join('\n')
  const exclusions =
    scope.exclusions.length > 0
      ? scope.exclusions.map((e) => `- \`${e}\``).join('\n')
      : '- (none specified beyond the constraints above)'

  return `# Rules of Engagement — AuditMesh authorized assessment

**This engagement is authorized.** A signed, scoped, time-bounded authorization for the target
below has been verified, and the target is on the AuditMesh allowlist. Stay strictly within the
scope defined here.

- **Correlation id:** ${correlationId}
- **Target (the ONLY host in scope):** ${target}
- **Assessment depth:** ${scope.maxDepth} (1 = surface only, 5 = thorough)
- **Time budget:** ${scope.maxDurationSeconds} seconds
- **Mode:** ${scope.nonDestructive ? 'NON-DESTRUCTIVE — read-only reconnaissance and analysis only. Do NOT perform any state-changing, account-mutating, or destructive action.' : 'active'}

## In scope — assess these classes of weakness
${categories}

## Out of scope — do NOT touch
${exclusions}
- Any host other than the target above. Do not follow links, redirects, or references off-target.
- Any denial-of-service, brute-force at scale, or data-exfiltration action.

## Deliverable
Produce a clear findings report. For each finding include: a title, a severity, the affected
component (route/header/endpoint), a short evidence excerpt, and concrete remediation guidance.
Prefer precision over volume; a smaller set of well-evidenced findings is more valuable than noise.
`
}
