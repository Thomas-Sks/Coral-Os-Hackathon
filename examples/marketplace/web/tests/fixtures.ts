import type { Round } from '../src/types'

/** A settled round — premium wins on value over cheap; lazy declined. Shapes match a real devnet run. */
export const settledRound: Round = {
  round: 1,
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [
    { by: 'seller-premium', priceSol: 0.0005, note: 'verified' },
    { by: 'seller-cheap', priceSol: 0.0002, note: 'undercut' },
  ],
  declined: ['seller-lazy'],
  award: { to: 'seller-premium', reason: 'verified data worth the premium for this lookup' },
  escrow: { reference: 'DKQy', seller: '7jwB', amountSol: 0.0005, deadlineSecs: 600 },
  deposit: { sig: '5syzoWto3RjRYfLMCAkJ', buyer: '47Dp' },
  delivered: { raw: '{"coin":"solana","usd":72.33}', data: { coin: 'solana', usd: 72.33 } },
  release: { sig: '3PMa9LBZn7VEMD1qZnmr' },
  status: 'settled',
}

/** A round still collecting bids. */
export const biddingRound: Round = {
  round: 2,
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [{ by: 'seller-cheap', priceSol: 0.0002 }],
  declined: [],
  status: 'bidding',
}

/** A valid, serialized AuditReport deliverable — what the escrow releases payment for. */
const auditReport = {
  schemaVersion: 1,
  correlationId: 'am-round-7',
  target: 'http://localhost:8899',
  generatedAt: '2026-07-02T12:00:00.000Z',
  grantedScope: {
    categories: ['injection', 'security-headers', 'sensitive-data'],
    exclusions: [],
    maxDepth: 3,
    maxDurationSeconds: 900,
    nonDestructive: true,
  },
  provenance: { source: 'prebaked', engine: 'strix', scanMode: 'quick' },
  findings: [
    {
      id: 'AM-001',
      title: 'SQL injection in product search',
      severity: 'critical',
      cvss: { version: '3.1', baseScore: 9.8, vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' },
      cwe: 'CWE-89',
      affectedComponent: '/rest/products/search?q=',
      evidence: "q=' OR 1=1-- returned the full product table",
      remediation: 'Use parameterized queries / an ORM; never concatenate user input into SQL.',
      tags: ['injection'],
    },
    {
      id: 'AM-002',
      title: 'Missing security headers',
      severity: 'medium',
      cwe: 'CWE-693',
      affectedComponent: 'GET / (response headers)',
      evidence: 'No Content-Security-Policy, X-Frame-Options, or HSTS header present.',
      remediation: 'Set CSP, X-Frame-Options: DENY, and Strict-Transport-Security.',
      tags: ['security-headers'],
    },
    {
      id: 'AM-003',
      title: 'Verbose error discloses stack trace',
      severity: 'low',
      affectedComponent: '/rest/user/login',
      evidence: '500 response leaks an Express stack trace and server file paths.',
      remediation: 'Return generic errors in production; log details server-side only.',
      tags: ['sensitive-data'],
    },
  ],
  summary: {
    totalFindings: 3,
    bySeverity: { info: 0, low: 1, medium: 1, high: 0, critical: 1 },
    highestSeverity: 'critical',
    headline: '3 findings — 1 critical, 0 high',
  },
}
const auditReportJson = JSON.stringify(auditReport)

/** A settled AuditMesh round — verified consent, a full delivery graph, and a real audit report. */
export const auditRound: Round = {
  round: 7,
  want: { service: 'audit', arg: 'inj+hdr+data', budgetSol: 0.02 },
  bids: [
    { by: 'seller-appsec', priceSol: 0.012, note: 'covers injection + headers' },
    { by: 'seller-netsec', priceSol: 0.009, note: 'tls + headers only' },
  ],
  declined: ['seller-lazy'],
  award: { to: 'seller-appsec', reason: 'broader scope coverage justified the higher bid' },
  authz: { hash: '9f2c1abed4c07e51aa93b7', status: 'verified' },
  escrow: { reference: 'AbCd', seller: '7jwB', amountSol: 0.012, deadlineSecs: 600 },
  deposit: { sig: '8kQzN2wp5RjRYfLMCAkJ', buyer: '47Dp' },
  delivery: {
    stages: [
      { stage: 'recon', status: 'done', note: '42 routes enumerated' },
      { stage: 'analysis', status: 'done', note: '3 issues confirmed' },
      { stage: 'reporting', status: 'done' },
    ],
  },
  delivered: { raw: auditReportJson, data: auditReport },
  release: { sig: '3PMa9LBZn7VEMD1qZnmr' },
  status: 'settled',
}

/** An AuditMesh round whose on-chain consent check failed — the demoable rejection state. */
export const rejectedRound: Round = {
  round: 8,
  want: { service: 'audit', arg: 'inj', budgetSol: 0.02 },
  bids: [{ by: 'seller-appsec', priceSol: 0.01 }],
  declined: [],
  award: { to: 'seller-appsec', reason: 'only bidder covering injection' },
  authz: {
    hash: 'deadbeefcafe01',
    status: 'rejected',
    code: 'TARGET_NOT_ALLOWLISTED',
    detail: 'requested host is not on the allowlist',
  },
  status: 'awarded',
}

export const fixtureRounds: Round[] = [settledRound, biddingRound]
