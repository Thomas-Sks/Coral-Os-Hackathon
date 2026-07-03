// Set up the REAL Strix security engine so a judge can run live scans (REPORT_SOURCE=live).
//
//   npm run setup:strix
//
// Does the "complete setup":
//   1. creates a Python venv (.venv-strix) and `pip install strix-agent`
//   2. pulls the Strix sandbox Docker image (~3 GB — Strix runs the actual scan inside it)
//   3. verifies the `strix` CLI works
//
// Why not commit the image to the repo? It's ~3 GB; GitHub caps files at 100 MB and Git LFS is
// impractical at that size. Downloading it here gives the judge the same complete setup, cleanly.
//
// On a flaky connection the plain `docker pull` can stall on the big layer (Docker can't resume a
// dropped layer). If that happens this script falls back to a RESUMABLE downloader
// (scripts/pull-strix-resumable.py → scripts/oci-to-docker-load.py) that survives drops.
//
// Prereqs: Python 3.12+, Docker (your user in the `docker` group), and (for scanning) an LLM key in
// .env — the same DEEPSEEK_API_KEY / STRIX_LLM that drive the agents also drive Strix.

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import os from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VENV = join(ROOT, '.venv-strix')
const IMAGE = 'ghcr.io/usestrix/strix-sandbox:1.0.0'
const isWin = os.platform() === 'win32'
const venvBin = (b) => join(VENV, isWin ? 'Scripts' : 'bin', b)

const log = (m) => console.log(`\x1b[36m[setup:strix]\x1b[0m ${m}`)
const warn = (m) => console.warn(`\x1b[33m[setup:strix]\x1b[0m ${m}`)
const die = (m) => { console.error(`\x1b[31m[setup:strix] ${m}\x1b[0m`); process.exit(1) }
const run = (cmd, opts = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
const out = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'pipe' }).toString().trim()

// 1. Python venv + strix-agent.
let py
for (const c of ['python3', 'python']) { try { const v = out(`${c} --version`); if (/3\.(1[2-9]|[2-9]\d)/.test(v)) { py = c; break } } catch { /* next */ } }
if (!py) die('Python 3.12+ is required for strix-agent (https://www.python.org/downloads/)')
log(`using ${py} (${out(`${py} --version`)})`)

if (!existsSync(venvBin('strix'))) {
  if (!existsSync(VENV)) { log('creating venv .venv-strix…'); run(`${py} -m venv .venv-strix`) }
  log('installing strix-agent (pip)…')
  run(`"${venvBin('pip')}" install --quiet --upgrade pip`)
  run(`"${venvBin('pip')}" install --quiet strix-agent`)
}
try { log(`strix ready: ${out(`"${venvBin('strix')}" --version`)}`) } catch { die('strix CLI did not install correctly') }

// 2. Docker + the sandbox image.
try { out('docker ps') } catch { die('cannot talk to Docker — is the daemon running and your user in the `docker` group?') }

let haveImage = false
try { haveImage = out(`docker images -q ${IMAGE}`).length > 0 } catch { /* */ }
if (haveImage) {
  log(`sandbox image already present ✓ (${IMAGE})`)
} else {
  log(`pulling the Strix sandbox image (~3 GB) — ${IMAGE} …`)
  let pulled = false
  try { run(`docker pull ${IMAGE}`); pulled = true } catch { warn('plain `docker pull` failed/stalled (flaky network?) — falling back to the resumable downloader') }
  if (!pulled) {
    // Resumable path: fetch blobs with resume, assemble an OCI layout, stream into docker load.
    log('resumable download (survives dropped connections)…')
    run(`${py} scripts/pull-strix-resumable.py`)
    log('loading the image into Docker…')
    run(`${py} scripts/oci-to-docker-load.py | docker load`, { shell: '/bin/bash' })
  }
  try { if (out(`docker images -q ${IMAGE}`).length === 0) die('sandbox image still missing after pull/load') } catch { die('could not verify the sandbox image') }
  log('sandbox image loaded ✓')
}

console.log('\n\x1b[32m✓ Strix is set up.\x1b[0m Run a real scan against the bundled target:')
console.log('   1) bring up the target:   docker compose -f docker-compose.auditmesh.yml up -d juice-shop target-frontdoor')
console.log('   2) run a live scan:       npm run scan:live        # writes reports/live-report.json')
console.log('   Or run the whole market with live scans:  REPORT_SOURCE=live npm run demo\n')
