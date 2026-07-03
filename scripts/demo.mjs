// AuditMesh one-command demo — the single command a judge runs (`npm run demo`).
//
// Runs the whole market end-to-end on Solana devnet:
//   WANT → BID → AWARD → (on-chain consent) → DEPOSITED → DELIVERED → RELEASED
//
// Steps (fully self-bootstrapping — a fresh clone needs only this command):
//   1. preflight (.env with a funded buyer wallet + an LLM key; Docker reachable)
//   2. install ALL dependencies + build the workspace packages
//   3. install Strix (MANDATORY) — the engine + its ~3 GB sandbox image
//   4. publish a fresh domain-control token + point coral at the right host address for this OS
//   5. bring up the target + start the host-side Strix SCAN BROKER (:7070) + the dashboard
//   6. build the agent images if missing; bring up coral; launch EXACTLY ONE session (buyer + 3 sellers)
//   7. the market negotiates (WANT→BID→AWARD); the WINNING seller then calls the broker to run the REAL,
//      scoped Strix scan (after the negotiation), delivers the report, and settles on devnet.
//
// Each round is a real scan (several minutes). The dashboard shows the negotiation, then the seller
// running the pentest, then the settlement with a clickable Explorer link.
//
// Then open http://localhost:5173 and watch the agents negotiate and settle. The RELEASE prints a
// clickable devnet Explorer link. Settlement is ALWAYS live on devnet; the report is the real captured
// Strix scan in the default REPORT_SOURCE=prebaked (set REPORT_SOURCE=live to run a fresh scan).
//
// Prereqs: Docker (your user in the `docker` group), Node 20+, a funded devnet buyer wallet
// (`npm run setup` → fund at https://faucet.solana.com), and an LLM key in .env (DeepSeek/Anthropic/…).

import { execSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import os from 'node:os'
import http from 'node:http'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MARKET = join(ROOT, 'examples', 'marketplace')
const CORAL_TOML = join(ROOT, 'examples', 'txodds', 'coral', 'coral.toml')
const COMPOSE = ['-f', join(ROOT, 'docker-compose.auditmesh.yml')]

const log = (m) => console.log(`\x1b[36m[demo]\x1b[0m ${m}`)
const warn = (m) => console.warn(`\x1b[33m[demo]\x1b[0m ${m}`)
const die = (m) => { console.error(`\x1b[31m[demo] ${m}\x1b[0m`); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function composeCmd() {
  for (const [bin, pre] of [['docker', ['compose']], ['docker-compose', []]]) {
    try { execSync(`${bin} ${pre.join(' ')} version`, { stdio: 'ignore' }); return { bin, pre } } catch { /* next */ }
  }
  return null
}

function loadEnv() {
  const env = { ...process.env }
  const p = join(ROOT, '.env')
  if (existsSync(p)) {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

const httpCode = (url, timeoutMs = 2500) => new Promise((resolve) => {
  const req = http.get(url, { timeout: timeoutMs }, (res) => { res.resume(); resolve(res.statusCode ?? 0) })
  req.on('error', () => resolve(0)); req.on('timeout', () => { req.destroy(); resolve(0) })
})

async function waitFor(label, ok, tries = 60, gap = 2000) {
  process.stdout.write(`\x1b[36m[demo]\x1b[0m waiting for ${label} `)
  for (let i = 0; i < tries; i++) { if (await ok()) { console.log('✓'); return true } process.stdout.write('.'); await sleep(gap) }
  console.log(' ✗'); return false
}

const npmInstalled = (dir) => existsSync(join(dir, 'node_modules'))

/** Install every host-side dependency and build the workspace packages (idempotent — skips what's done). */
function bootstrap() {
  // Workspace packages: installs deps if missing + builds dist (feed/web import these via file: deps).
  log('installing + building the workspace packages (@pay/agent-runtime, @auditmesh/*)…')
  execSync('node scripts/build-packages.mjs', { cwd: ROOT, stdio: 'inherit' })
  // Host-side apps that run OUTSIDE Docker (the launcher, the dashboard feed + web).
  for (const [dir, label] of [
    [MARKET, 'marketplace launcher'],
    [join(MARKET, 'feed'), 'dashboard feed'],
    [join(MARKET, 'web'), 'dashboard web'],
  ]) {
    if (!npmInstalled(dir)) { log(`installing deps: ${label}…`); execSync('npm install', { cwd: dir, stdio: 'inherit' }) }
  }
  // (The two agent images install their own deps inside Docker — handled by build-audit-agents.sh.)
}

/** Point coral at the host address agents can reach on THIS OS (Linux bridge gw vs Docker Desktop). */
function fixCoralAddress() {
  const addr = os.platform() === 'linux' ? '172.17.0.1' : 'host.docker.internal'
  const toml = readFileSync(CORAL_TOML, 'utf8')
  const next = toml.replace(/address\s*=\s*"[^"]*"/, `address = "${addr}"`)
  if (next !== toml) { writeFileSync(CORAL_TOML, next); log(`coral [docker].address → ${addr} (${os.platform()})`) }
  return addr
}

/** Strix is MANDATORY: install the engine + pull its sandbox image (hard fail if it can't). */
function ensureStrix() {
  log('ensuring the Strix engine is installed (mandatory)…')
  try { execSync('node scripts/setup-strix.mjs', { cwd: ROOT, stdio: 'inherit' }) }
  catch { die('Strix setup failed — it is required. Fix the error above (Python 3.12+, Docker, network for the ~3 GB image) and re-run.') }
}

/** Run a REAL Strix scan against the live target → refreshes reports/prebaked-juice-shop.json. */
function runStrixScan(env) {
  try {
    execSync('node scripts/run-strix-live.mjs', {
      cwd: ROOT, stdio: 'inherit',
      env: { ...env, STRIX_TARGET: env.STRIX_TARGET || 'http://172.17.0.1:8899' },
    })
    return true
  } catch { return false }
}

async function main() {
  const env = loadEnv()
  const compose = composeCmd()
  if (!compose) die('no docker compose found — install Docker and make sure your user is in the `docker` group')
  const dc = (args) => execSync([compose.bin, ...compose.pre, ...COMPOSE, ...args].join(' '), { cwd: ROOT, stdio: 'inherit', env })
  const docker = (args) => execSync(`docker ${args}`, { cwd: ROOT, stdio: 'pipe', env }).toString().trim()

  // 1. Preflight.
  try { docker('ps') } catch { die('cannot talk to Docker — is the daemon running and is your user in the `docker` group? (`sudo usermod -aG docker $USER`, then re-login)') }
  if (!env.BUYER_KEYPAIR_B58 || !env.WALLET) die('missing wallets in .env — run `npm run setup`, then fund the buyer at https://faucet.solana.com')
  const hasLlm = env.DEEPSEEK_API_KEY || env.LLM_API_KEY || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY || env.VENICE_API_KEY
  if (!hasLlm) die('no LLM key in .env — set DEEPSEEK_API_KEY (recommended) or ANTHROPIC/OPENAI/VENICE, and LLM_PROVIDER')
  if ((env.SETTLEMENT_MODE ?? 'direct') === 'arbiter' && !env.ARBITER_KEYPAIR_B58) die('SETTLEMENT_MODE=arbiter needs ARBITER_KEYPAIR_B58 — run `npm run setup`, or set SETTLEMENT_MODE=direct')

  // 2. Bootstrap — install every dependency + build the packages (first run does real work; re-runs skip).
  bootstrap()

  // 3. Strix is mandatory — install the engine + pull its sandbox image.
  ensureStrix()

  // 4. OS-correct coral address + publish a fresh domain-control token.
  fixCoralAddress()
  log('publishing a fresh domain-control token at the target…')
  const nonce = execSync('node target/write-token.mjs', { cwd: ROOT }).toString().trim()
  if (!/^[0-9a-f]{32}$/.test(nonce)) die(`unexpected nonce: ${nonce}`)
  env.AUTHZ_NONCE = nonce
  log(`AUTHZ_NONCE=${nonce}`)

  // 5. Bring up the whole stack (coral + Juice Shop + front-door) in ONE up — avoids docker-compose
  //    re-inspecting existing containers (which the legacy v1 chokes on). Uses `docker compose` v2 if present.
  log('bringing up coral-server + the bundled target…')
  dc(['up', '-d'])
  const tokenUp = await waitFor('target token (:8899)', async () => (await httpCode('http://localhost:8899/.well-known/auditmesh-authz.txt')) === 200)
  if (!tokenUp) die('target not reachable on :8899 — check `docker logs target-frontdoor` / `juice-shop`')

  const bg = (cmd, args, cwd, extraEnv = {}) =>
    spawn(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: 'ignore', detached: true }).on('error', () => {})

  // 6. Start the host-side SCAN BROKER — the winning seller calls it to run the real, scoped Strix scan
  //    AFTER it wins the negotiation (the seller's container can't run Docker-in-Docker itself).
  log('starting the Strix scan broker (host :7070)…')
  const broker = bg('node', ['scripts/scan-broker.mjs'], ROOT)
  broker.unref()
  const brokerUp = await waitFor('scan broker (:7070)', async () => (await httpCode('http://localhost:7070/health')) === 200, 30, 1000)
  if (!brokerUp) warn('scan broker did not answer on :7070 — check that Strix is installed (`npm run setup:strix`)')

  // 7. Start the DASHBOARD web now so it's reachable; the feed is pinned to the session once it exists (below).
  const feedEnv = (sid) => ({ SESSION: sid, MARKET_SELLERS: 'audit-discounter,audit-tls-specialist,audit-premium', PORT: '4000' })
  log('starting the dashboard web (:5173)…')
  const web = bg('npm', ['run', 'dev'], join(MARKET, 'web'))
  web.unref()
  await waitFor('dashboard (:5173)', async () => (await httpCode('http://localhost:5173')) === 200, 40, 1500)
  console.log('\n  \x1b[1m→ Open http://localhost:5173\x1b[0m — it follows the live market automatically (no id needed).\n')

  // 8. Build the agent images if missing (first run only). No per-run rebake: the scan is now live per-round.
  const haveImages = ['audit-buyer:0.1.0', 'audit-seller:0.1.0'].every((img) => {
    try { return docker(`images -q ${img}`).length > 0 } catch { return false }
  })
  if (!haveImages) { log('building the agent images (first run, ~5 min)…'); execSync('bash build-audit-agents.sh', { cwd: ROOT, stdio: 'inherit', env }) }
  else log('agent images already built ✓')

  // 9. Clean slate — restart coral so no prior session lingers, wait for readiness.
  log('restarting coral for a clean slate…')
  try { docker('restart coral') } catch { /* fresh create, fine */ }
  const coralUp = await waitFor('coral-server (:5555)', async () => (await httpCode('http://localhost:5555')) !== 0)
  if (!coralUp) warn('coral did not answer on :5555 — check `docker logs coral`')

  // 10. Launch EXACTLY ONE session.
  log('launching the market session (buyer + 3 seller personas)…')
  const out = execSync('npm run start:audit', { cwd: MARKET, env }).toString()
  process.stdout.write(out)
  const sessionId = out.match(/AuditMesh session (\S+)/)?.[1]
  if (!sessionId) warn('could not parse the session id — the feed will fall back to SESSION from env')

  // 11. Start the feed pinned to THIS session (killing any stale :4000 listener) so localhost:5173
  //     follows it with no ?session needed.
  try { execSync("for p in $(lsof -ti:4000 2>/dev/null); do kill -9 $p 2>/dev/null; done", { shell: '/bin/bash', stdio: 'ignore' }) } catch { /* lsof may be absent */ }
  await sleep(800)
  const feed = bg('npm', ['start'], join(MARKET, 'feed'), feedEnv(sessionId ?? ''))
  feed.unref()
  await waitFor('dashboard feed (:4000)', async () => (await httpCode('http://localhost:4000/api/health')) === 200, 20, 1000)

  await sleep(3500)
  console.log('\n\x1b[32m════════════════════════════════════════════════════════════\x1b[0m')
  console.log('\x1b[32m  AuditMesh is live.\x1b[0m')
  console.log('  Dashboard:  \x1b[1mhttp://localhost:5173\x1b[0m   (watch the agents negotiate + settle)')
  console.log(`  Session:    ${sessionId ?? '(see output above)'}`)
  console.log('  A new debate runs about every ~30s. YOUR run\'s devnet Explorer link appears:')
  console.log('    • on the dashboard\'s settlement card (clickable), and')
  console.log(`    • via the feed:  curl -s "http://localhost:4000/api/feed?session=${sessionId ?? '<id>'}" | grep -o 'tx/[^"]*' | tail -1`)
  console.log('  The dashboard + containers keep running after this. To stop everything:')
  console.log(`     ${compose.bin} ${compose.pre.join(' ')} -f docker-compose.auditmesh.yml down   # + kill the :4000/:5173 node servers`)
  process.exit(0)
  console.log('\x1b[32m════════════════════════════════════════════════════════════\x1b[0m\n')
}

main().catch((e) => die(e?.stack ?? String(e)))
