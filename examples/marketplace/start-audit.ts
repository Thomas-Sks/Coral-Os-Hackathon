/**
 * AuditMesh market launcher — the security-assessment fork of start.ts.
 *
 * Launches one CoralOS session graph: the AuditMesh buyer + three competing seller personas
 * (audit-discounter / audit-tls-specialist / audit-premium). coral-server spawns each as a container.
 * The buyer broadcasts an `audit` WANT, proves control of the bundled target and signs a scoped
 * authorization, the sellers compete, the winner verifies consent + runs the assessment, and the deal
 * settles through the devnet escrow. Personas differ only by their coral-agent.toml — not code.
 *
 *   CORAL_SERVER_URL  default http://localhost:5555
 *   CORAL_TOKEN       default dev   (must be in coral.toml [auth] keys)
 *   AUTHZ_NONCE       the token published at <target>/.well-known/auditmesh-authz.txt
 *                     (scripts/demo.mjs publishes it + passes it here)
 *
 * Run from the host after coral-server + the target are up:  npm run start:audit
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

function loadEnv(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on process.env */ }
  return env
}

const str = (value: string) => ({ type: 'string', value })
const f64 = (value: number) => ({ type: 'f64', value })

const agent = (name: string, options: Record<string, unknown>) => ({
  id: { name, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
  options,
})

async function main() {
  const env = loadEnv()
  const wallet = env.WALLET
  const keypair = env.BUYER_KEYPAIR_B58
  if (!wallet || !keypair) {
    throw new Error('WALLET and BUYER_KEYPAIR_B58 must be set in .env — run `node scripts/setup.js`')
  }
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  const trace = env.TRACE ?? ''
  const target = env.AUDIT_TARGET ?? 'http://target-frontdoor'
  const nonce = env.AUTHZ_NONCE ?? ''
  const reportSource = env.REPORT_SOURCE ?? 'prebaked'
  const settlement = env.SETTLEMENT_MODE ?? 'arbiter'

  if (!nonce) {
    console.warn('[auditmesh] AUTHZ_NONCE is empty — publish a token at the target and set AUTHZ_NONCE ' +
      '(scripts/demo.mjs does this). Without it the seller rejects consent — which is itself a demoable path.')
  }
  if (settlement === 'arbiter' && !env.ARBITER_KEYPAIR_B58) {
    throw new Error('SETTLEMENT_MODE=arbiter needs ARBITER_KEYPAIR_B58 — run `node scripts/setup.js` (or set SETTLEMENT_MODE=direct).')
  }

  // Bidding LLM (Venice/OpenAI/Anthropic). The Strix engine key is LLM_API_KEY (live mode only).
  const llmOpts: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llmOpts.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.OPENAI_API_KEY) llmOpts.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llmOpts.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.DEEPSEEK_API_KEY) llmOpts.DEEPSEEK_API_KEY = str(env.DEEPSEEK_API_KEY)
  if (env.LLM_PROVIDER) llmOpts.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llmOpts.LLM_MODEL = str(env.LLM_MODEL)
  if (trace) llmOpts.TRACE = str(trace)

  // Seller options shared by every persona (the persona itself — strategy/floor/scope — is the TOML).
  const sellerCommon: Record<string, unknown> = {
    SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc),
    SETTLEMENT_MODE: str(settlement), AUDIT_TARGET: str(target),
    REPORT_SOURCE: str(reportSource),
    // NOTE: SCAN_MODE is intentionally NOT forced here — each persona sets its own depth
    // (quick | standard | deep) in its coral-agent.toml, so the offer maps to a real scan.
    ...(env.STRIX_LLM ? { STRIX_LLM: str(env.STRIX_LLM) } : {}),
    ...(env.LLM_API_KEY ? { LLM_API_KEY: str(env.LLM_API_KEY) } : {}),
    ...(env.SCAN_BROKER_URL ? { SCAN_BROKER_URL: str(env.SCAN_BROKER_URL) } : {}),
    ...(env.SOL_EUR ? { SOL_EUR: f64(Number(env.SOL_EUR)) } : {}),
    ...(env.LLM_EUR_PER_MTOKEN ? { LLM_EUR_PER_MTOKEN: f64(Number(env.LLM_EUR_PER_MTOKEN)) } : {}),
    ...(env.DELIVERY_PACING_MS ? { DELIVERY_PACING_MS: f64(Number(env.DELIVERY_PACING_MS)) } : {}),
    ...(env.ESCROW_DEADLINE_SECS ? { ESCROW_DEADLINE_SECS: f64(Number(env.ESCROW_DEADLINE_SECS)) } : {}),
    ...llmOpts,
  }
  const sellerNames = (env.MARKET_SELLERS ?? 'audit-discounter,audit-tls-specialist,audit-premium')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const seller = (name: string) => agent(name, { AGENT_NAME: str(name), ...sellerCommon })

  const buyerOpts: Record<string, unknown> = {
    BUYER_KEYPAIR_B58: str(keypair),
    AGENT_NAME: str('audit-buyer'),
    SOLANA_RPC_URL: str(rpc),
    SELLER_WALLET: str(wallet), // expected payout — the buyer binds the escrow to it
    BUYER_MAX_SOL: f64(Number(env.BUYER_MAX_SOL ?? '0.02')),
    AUDIT_TARGET: str(target),
    AUTHZ_NONCE: str(nonce),
    SETTLEMENT_MODE: str(settlement),
    MARKET_SELLERS: str(sellerNames.join(',')),
    ...(env.BID_WINDOW_MS ? { BID_WINDOW_MS: f64(Number(env.BID_WINDOW_MS)) } : {}),
    ...(env.CYCLE_INTERVAL_MS ? { CYCLE_INTERVAL_MS: f64(Number(env.CYCLE_INTERVAL_MS)) } : {}),
    ...(env.DELIVERED_WAIT_MS ? { DELIVERED_WAIT_MS: f64(Number(env.DELIVERED_WAIT_MS)) } : {}),
    ...(env.AUDIT_SCOPES ? { AUDIT_SCOPES: str(env.AUDIT_SCOPES) } : {}),
    ...(env.AUDIT_SURFACE ? { AUDIT_SURFACE: str(env.AUDIT_SURFACE) } : {}),
    ...(env.AUDIT_EXCLUSIONS ? { AUDIT_EXCLUSIONS: str(env.AUDIT_EXCLUSIONS) } : {}),
    ...(settlement === 'arbiter' ? { ARBITER_KEYPAIR_B58: str(env.ARBITER_KEYPAIR_B58) } : {}),
    ...llmOpts,
  }

  const sres = await fetch(`${BASE}/api/v1/local/session`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      agentGraphRequest: {
        agents: [agent('audit-buyer', buyerOpts), ...sellerNames.map(seller)],
      },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = (await sres.json()) as { sessionId: string }

  console.log(`\n✅ AuditMesh session ${sessionId} — buyer + ${sellerNames.join(', ')}.`)
  console.log(`   target: ${target}   report source: ${reportSource}   settlement: ${settlement}`)
  console.log('   Buyer broadcasts an audit WANT; sellers bid; the winner verifies on-chain consent, assesses, and settles via escrow.\n')
  console.log('   The dashboard renders this session live:')
  console.log(`     SESSION=${sessionId} npm run feed         # feed on :4000`)
  console.log('     npm run web                                # dashboard on :5173')
  console.log('   Or watch the containers directly:')
  console.log('     docker logs -f audit-buyer                 # WANT → AWARD → DECISION-TO-PAY → RELEASED')
  console.log('     docker logs -f audit-premium               # BID → AUTHZ_RESULT → DELIVERY_PROGRESS → DELIVERED\n')
}

main().catch((e) => { console.error(`[auditmesh] ${e}`); process.exitCode = 1 })
