#!/usr/bin/env node
// Launch any example with cold-start parity (mirrors scripts/txodds.js): build the runtime if the
// example needs it, install the example's deps on first run, then run its npm script.
//
//   node scripts/run-example.js <relativeDir> <npmScript>
//
// Used by the root `npm run marketplace`, `npm run agent-economy`, … shortcuts. So a fresh clone can do
// `npm run marketplace` and it just works — no manual `npm install` per example.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [rel, script] = process.argv.slice(2)
if (!rel || !script) {
  console.error('usage: node scripts/run-example.js <relativeDir> <npmScript>')
  process.exit(1)
}
const dir = join(root, rel)
if (!existsSync(join(dir, 'package.json'))) {
  console.error(`[example] no package.json at ${rel} — is the path right?`)
  process.exit(1)
}

// The kit targets Node 20+ (matches scripts/txodds.js).
if (Number(process.versions.node.split('.')[0]) < 20) {
  console.error(`[example] Node ${process.version} detected — this kit needs Node 20+. Install from nodejs.org, then re-run.`)
  process.exit(1)
}

const npm = (cwd, args) => spawnSync('npm', args, { cwd, shell: true, stdio: 'inherit' })

// If the example depends on @pay/agent-runtime (a `file:` dep that reads dist/), make sure it's built.
const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }
if (deps['@pay/agent-runtime']) {
  const runtime = join(root, 'packages', 'agent-runtime')
  if (!existsSync(join(runtime, 'node_modules'))) {
    console.log('[example] installing @pay/agent-runtime …')
    npm(runtime, ['install', '--no-audit', '--no-fund'])
  }
  if (!existsSync(join(runtime, 'dist'))) {
    console.log('[example] building @pay/agent-runtime (dist) …')
    npm(runtime, ['run', 'build'])
  }
}

// Install the example's own deps on first run.
if (!existsSync(join(dir, 'node_modules'))) {
  console.log(`[example] installing deps in ${rel} …`)
  npm(dir, ['install', '--no-audit', '--no-fund'])
}

console.log(`[example] ${rel} → npm run ${script}\n`)
const child = spawn('npm', ['run', script], { cwd: dir, shell: true, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
const stop = () => { child.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
