// write-token.mjs — publish the AuditMesh domain-control authorization token.
//
// AuditMesh proves control of the target by fetching
//   http://<target>/.well-known/auditmesh-authz.txt
// and checking that the body contains `auditmesh-authz=<nonce>`. The front-door
// nginx serves that path from ./.well-known/auditmesh-authz.txt, and THIS script
// is what writes the nonce into that file.
//
// Usage:
//   node write-token.mjs <nonce>   # write the given nonce
//   node write-token.mjs           # generate a random nonce, write it, and
//                                  # print ONLY the nonce to stdout so a shell
//                                  # can capture it, e.g.  NONCE=$(node write-token.mjs)
//
// The token path is resolved relative to this script's own location (via
// import.meta.url), NOT the process cwd, so it works no matter where it's run from.

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const tokenPath = join(scriptDir, '.well-known', 'auditmesh-authz.txt')

const argNonce = process.argv[2]
const generated = argNonce === undefined
const nonce = generated ? randomBytes(16).toString('hex') : argNonce

writeFileSync(tokenPath, `auditmesh-authz=${nonce}\n`)

// When we generated the nonce, emit ONLY the nonce on stdout so it can be
// captured. When the caller supplied it, they already have it — stay quiet on
// stdout and just report to stderr.
if (generated) {
  process.stdout.write(`${nonce}\n`)
} else {
  process.stderr.write(`wrote auditmesh-authz token to ${tokenPath}\n`)
}
