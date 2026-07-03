#!/usr/bin/env node
// One-command TxODDS World Cup Oracle: the data/escrow proxy + the static web UI, then open the browser.
//
//   node scripts/txodds.js        (= npm run dev)
//
// Two processes:
//   - proxy (port 8801) — subscribes the buyer wallet to the free World Cup tier on devnet and serves
//     live fixtures/odds + a real escrow deposit→release for the "Settle this edge" button.
//   - web   (port 3020) — the React Oracle page. It falls back to baked-in demo data if the proxy is
//     down or the wallet isn't funded, so the board is ALWAYS presentable — `.env` only adds live data.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const url = 'http://localhost:3020'

// Fail fast on an unsupported Node (the kit targets Node 20+).
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`[txodds] Node ${process.version} detected — this kit needs Node 20+. Install it from nodejs.org, then re-run.`)
  process.exit(1)
}

// Install deps on first run so a cold checkout works.
if (!existsSync(join(txDir, 'node_modules'))) {
  console.log('[txodds] installing deps in examples/txodds …')
  spawnSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: txDir, shell: true, stdio: 'inherit' })
}

// proxy first (live data + escrow), then the web UI. The page works even if the proxy can't get a
// token — it shows demo data — so a missing/empty .env never blocks the dashboard from opening.
const proxy = spawn('npm', ['run', 'proxy'], { cwd: txDir, shell: true, stdio: 'inherit' })
const web = spawn('npm', ['run', 'web'], { cwd: txDir, shell: true, stdio: 'inherit' })

setTimeout(() => {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { shell: true, stdio: 'ignore' })
  console.log(`\n[txodds] opened ${url} — World Cup Oracle (proxy on :8801 for live data + settle).\n`)
}, 4000)

const stop = () => { proxy.kill(); web.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
