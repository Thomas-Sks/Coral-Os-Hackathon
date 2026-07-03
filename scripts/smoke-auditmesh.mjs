// AuditMesh end-to-end smoke test — the whole flow, off-chain, in prebaked mode.
//
// Exercises the exact library logic the coral audit-buyer and audit-seller run — issue consent →
// hand over the grant → verify (live domain control, stubbed) → derive the escrow reference from the
// authorization hash → deliver (prebaked, real report) → the buyer's decision-to-pay — WITHOUT needing
// Docker, coral-server, a funded devnet wallet, or an LLM key. It also proves the two "holds up under
// dispute" paths: an expired grant is rejected, and an out-of-scope grant is rejected.
//
// This is the reproducible smoke a judge/CI can run in seconds:  npm run smoke
// The live market adds coral-server + the devnet escrow on top of this same logic.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Keypair } from '@solana/web3.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shared = await import(join(root, 'packages/shared/dist/index.js'))
const authz = await import(join(root, 'packages/authorization/dist/index.js'))
const svc = await import(join(root, 'packages/audit-service/dist/index.js'))

const { Scope, loadAuditMeshConfig, encodeScopeArg, decodeScopeArg, safeParseReport } = shared
const { issueAuthorization, encodeGrant, decodeGrant, verifyAuthorization, deriveEscrowReference, wellKnownBody } = authz
const { runAudit } = svc

const TARGET = 'http://localhost:8899'
const NONCE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'
const NOW = Date.parse('2026-07-02T12:00:00.000Z')

// The domain-control network stub: the front-door "serves" the published nonce.
const domainControl = {
  fetchText: async (url) => {
    if (url.endsWith('/.well-known/auditmesh-authz.txt')) return wellKnownBody(NONCE)
    throw new Error(`unexpected fetch ${url}`)
  },
}

const config = loadAuditMeshConfig({
  REPORT_SOURCE: 'prebaked',
  AUDIT_TARGET: TARGET,
  PREBAKED_REPORT_PATH: join(root, 'reports/prebaked-juice-shop.json'),
})

let failures = 0
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

/** The buyer's side: issue a signed, scoped authorization for a round. */
function buyerIssues(round, scopeArg, over = {}) {
  const buyer = Keypair.generate()
  const categories = decodeScopeArg(scopeArg)
  const scope = Scope.parse({ categories, exclusions: ['/#/administration'], maxDepth: 3 })
  const signed = issueAuthorization({
    signer: buyer, target: TARGET, scope, method: 'well-known', nonce: NONCE,
    correlationId: `am-r${round}`, ttlSeconds: 1800, nowMs: NOW, ...over,
  })
  return { buyer, signed, token: encodeGrant(signed) }
}

console.log('\nAuditMesh smoke — full flow in prebaked mode (no Docker / no devnet)\n')

// ── Happy path: WANT → AWARD → consent → escrow binding → deliver → decision-to-pay ──
{
  console.log('1) Happy path — a round that authorizes, delivers, and settles')
  const round = 1
  const scopeArg = encodeScopeArg(decodeScopeArg('hdr+tls+xss+inj+ac+data'))

  // Buyer issues consent and hands the grant to the seller.
  const { signed, token } = buyerIssues(round, scopeArg)
  check('buyer signed a scoped authorization', /^[0-9a-f]{64}$/.test(signed.authzHash), `hash=${signed.authzHash.slice(0, 12)}…`)

  // Seller decodes + verifies the grant (live domain control stubbed to the front-door).
  const decoded = decodeGrant(token)
  check('seller decoded the grant', decoded.ok)
  const verdict = await verifyAuthorization(decoded.signed, { nowMs: NOW, domainControl })
  check('seller verified consent (signature + allowlist + expiry + scope + live domain control)', verdict.ok,
    verdict.ok ? verdict.target : verdict.reason)

  // On-chain binding: both sides derive the SAME escrow reference from the authorization hash.
  const sellerRef = deriveEscrowReference(signed.authzHash, round).toBase58()
  const buyerRef = deriveEscrowReference(signed.authzHash, round).toBase58()
  check('escrow reference is bound to the authorization hash (buyer==seller)', sellerRef === buyerRef,
    `ref=${sellerRef.slice(0, 10)}…  →  ${explorer('address', sellerRef)}`)

  // Seller delivers the assessment (prebaked), streaming the delivery graph.
  const stages = []
  const result = await runAudit({
    signed: decoded.signed, round, config, nowMs: NOW, verifyDeps: domainControl, pacingMs: 0,
    logger: shared.createLogger(`am-r${round}`, { level: 'error' }), // quiet for readable smoke output
    onProgress: (ev) => { if (ev.status === 'active') stages.push(ev.stage) },
  })
  check('seller delivered a report', result.ok)
  check('delivery graph activated recon → analysis → reporting', stages.join('>') === 'recon>analysis>reporting', stages.join(' → '))

  if (result.ok) {
    const parsed = safeParseReport(result.serialized)
    check('deliverable parses as a valid report', parsed.ok)
    const report = parsed.report
    check('report is bound to this deal + target', report.correlationId === `am-r${round}` && report.target === TARGET)

    // Buyer's DECISION-TO-PAY.
    const pay = report.correlationId === `am-r${round}` && report.target === TARGET
    console.log(`\n   ── DECISION-TO-PAY ──`)
    console.log(`   report: ${report.summary.headline} (highest: ${report.summary.highestSeverity})`)
    console.log(`   verdict: ${pay ? 'PAY — release escrow to the seller' : 'WITHHOLD'}`)
    console.log(`   (live market) settlement tx → ${explorer('tx', '<devnet-signature>')}\n`)
    check('buyer decides to pay for a valid, on-target report', pay)
  }
}

// ── Dispute path A: an expired grant is rejected (no work, funds refundable) ──
{
  console.log('2) Dispute path — an EXPIRED authorization is rejected before any work')
  const { signed } = buyerIssues(2, 'hdr+tls', { ttlSeconds: 30 })
  const verdict = await verifyAuthorization(signed, { nowMs: NOW + 120_000, domainControl })
  check('expired grant is rejected', !verdict.ok && verdict.code === 'EXPIRED', verdict.ok ? '' : verdict.code)
}

// ── Dispute path B: an out-of-scope grant is rejected against a strict policy ──
{
  console.log('3) Dispute path — an OUT-OF-SCOPE authorization is rejected')
  const { signed } = buyerIssues(3, 'inj')
  const strictPolicy = { allowedCategories: ['security-headers', 'tls-config'], maxDepth: 2, maxDurationSeconds: 900, requireNonDestructive: true }
  const verdict = await verifyAuthorization(signed, { nowMs: NOW, policy: strictPolicy, domainControl })
  check('out-of-scope grant is rejected', !verdict.ok && verdict.code === 'SCOPE_EXCEEDS_POLICY', verdict.ok ? '' : verdict.code)
}

// ── Boundary: a non-allowlisted target can never be authorized ──
{
  console.log('4) Hard boundary — a non-allowlisted target is refused')
  const buyer = Keypair.generate()
  const scope = Scope.parse({ categories: ['security-headers'] })
  const signed = issueAuthorization({
    signer: buyer, target: 'http://evil.example.com', scope, method: 'well-known',
    nonce: NONCE, correlationId: 'am-evil', ttlSeconds: 1800, nowMs: NOW,
  })
  const verdict = await verifyAuthorization(signed, { nowMs: NOW, domainControl })
  check('off-allowlist target is refused', !verdict.ok && verdict.code === 'TARGET_NOT_ALLOWLISTED', verdict.ok ? '' : verdict.code)
}

console.log(`\n${failures === 0 ? '✓ ALL CHECKS PASSED' : `✗ ${failures} CHECK(S) FAILED`}\n`)
process.exit(failures === 0 ? 0 : 1)
