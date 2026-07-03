// Install + build the AuditMesh workspace packages in dependency order.
//
// A fresh clone needs the built `dist/` of each package before the dashboard feed, the smoke test, or
// a local agent run can import them (they are wired as file: deps). Run:  npm run packages
//
//   @pay/agent-runtime  →  @auditmesh/shared  →  @auditmesh/authorization  →  @auditmesh/audit-service

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = [
  'packages/agent-runtime',
  'packages/shared',
  'packages/authorization',
  'packages/audit-service',
]

for (const rel of PACKAGES) {
  const dir = join(ROOT, rel)
  console.log(`\n\x1b[36m==> ${rel}\x1b[0m`)
  if (!existsSync(join(dir, 'node_modules'))) {
    execSync('npm install', { cwd: dir, stdio: 'inherit' })
  }
  execSync('npm run build', { cwd: dir, stdio: 'inherit' })
}
console.log('\n\x1b[32m✓ all packages built\x1b[0m')
