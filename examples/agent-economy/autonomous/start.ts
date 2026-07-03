/**
 * Autonomous path starter — kicks off the agent↔agent economy on CoralOS.
 *
 * coral-server launches agents *per session*, so the autonomous buyer↔seller loop begins the
 * moment a session naming both is created. Required agent options (the buyer's keypair, the
 * seller's wallet) MUST be passed in the request — coral has no default for them — so this
 * script loads them from the repo-root `.env` and sends them as typed options.
 *
 *   CORAL_SERVER_URL  default http://localhost:5555
 *   CORAL_TOKEN       default dev   (must be in coral.toml [auth] keys)
 *
 * Run from the host after `docker compose up coral`:  npm install && npm start
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

// ── Load repo-root .env (3 levels up: autonomous → agent-economy → examples → root) ──
function loadEnv(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  const env: Record<string, string> = { ...process.env as Record<string, string> }
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on process.env */ }
  return env
}

// ── Typed coral option values: { type: "string" | "f64", value } ──
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
  const service = env.SERVICE ?? 'jupiter'

  // LLM keys forwarded to both agents — the kit uses Venice AI (see LLM.md); openai/anthropic also work.
  const llm: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llm.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.OPENAI_API_KEY) llm.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llm.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.LLM_PROVIDER) llm.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llm.LLM_MODEL = str(env.LLM_MODEL)

  const sellerOpts: Record<string, unknown> = {
    SELLER_WALLET: str(wallet),
    SOLANA_RPC_URL: str(rpc),
    SERVICE: str(service),
    ...llm,
  }

  const buyerOpts: Record<string, unknown> = {
    BUYER_KEYPAIR_B58: str(keypair),
    SOLANA_RPC_URL: str(rpc),
    BUYER_MAX_SOL: f64(Number(env.BUYER_MAX_SOL ?? '0.001')),
    ...llm,
  }

  // Create a session with both agents — coral spawns their containers and connects them.
  const sres = await fetch(`${BASE}/api/v1/local/session`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      agentGraphRequest: {
        agents: [agent('buyer-agent', buyerOpts), agent('seller-agent', sellerOpts)],
      },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = await sres.json() as { sessionId: string }

  console.log(`\n✅ Session ${sessionId} created with [buyer-agent, seller-agent].`)
  console.log(`   seller wallet: ${wallet}`)
  console.log('   The buyer will open a thread and start its purchase loop.\n')
  console.log('   Watch it settle:')
  console.log('     docker logs -f buyer-agent     # "paying reference=…" → "received data"')
  console.log('     docker logs -f seller-agent    # "payment verified — delivering service"')
  console.log('   Each payment is a real devnet tx — paste the sig into explorer.solana.com (?cluster=devnet).\n')
}

main().catch((e) => { console.error(`[autonomous] ${e}`); process.exitCode = 1 })
