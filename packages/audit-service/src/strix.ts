/**
 * Strix subprocess wrapper (the `live` path).
 *
 * We author NO offensive logic. This module only *invokes* the existing open-source Strix engine as
 * a headless subprocess against the single allowlisted target, streams its stdout so the delivery
 * graph can animate, enforces a hard timeout, and then reads the run directory. Every failure mode
 * is a typed result (never a throw) so the seller can degrade cleanly — a timeout or spawn failure
 * becomes a non-delivery, and the buyer's escrow refunds on the deadline.
 *
 * Strix CLI (verified): `strix -n -t <target> -m <quick|standard|deep> --instruction-file <path>`,
 * env `STRIX_LLM="provider/model"` + `LLM_API_KEY`, Docker sandbox, output under `strix_runs/<run>/`.
 */

import { spawn, type SpawnOptions } from 'node:child_process'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { parseStrixFindings } from './parser.js'
import type { Finding } from '@auditmesh/shared'

export type StrixErrorCode =
  | 'STRIX_SPAWN_FAILED'
  | 'STRIX_TIMEOUT'
  | 'STRIX_NO_OUTPUT'

export interface RunStrixInput {
  target: string
  scanMode: 'quick' | 'standard' | 'deep'
  instructionPath: string
  /** provider/model, e.g. "anthropic/claude-sonnet-4-6". */
  model: string
  /** The LLM API key passed to Strix as LLM_API_KEY. */
  llmApiKey: string
  timeoutSeconds: number
  /** Working directory; Strix writes `strix_runs/<run>/` beneath it. */
  workingDir: string
  /** Called per stdout/stderr line — wire this to the delivery-graph progress emitter. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  /** Abort the run early. */
  signal?: AbortSignal
  /** Injected spawn for tests; defaults to node:child_process spawn. */
  spawnImpl?: typeof spawn
}

export type RunStrixResult =
  | { ok: true; runDir: string; exitCode: number | null }
  | { ok: false; code: StrixErrorCode; reason: string }

/** Spawn Strix headless and resolve to the run directory it produced. Never throws. */
export async function runStrix(input: RunStrixInput): Promise<RunStrixResult> {
  const runsRoot = path.join(input.workingDir, 'strix_runs')
  const before = await listDirs(runsRoot)

  const args = [
    '-n',
    '-t',
    input.target,
    '-m',
    input.scanMode,
    '--instruction-file',
    input.instructionPath,
  ]
  const options: SpawnOptions = {
    cwd: input.workingDir,
    env: {
      ...process.env,
      STRIX_LLM: input.model,
      LLM_API_KEY: input.llmApiKey,
      // Quick scans want less deliberation; keep it snappy for the demo.
      STRIX_REASONING_EFFORT: input.scanMode === 'quick' ? 'medium' : 'high',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }

  const doSpawn = input.spawnImpl ?? spawn
  return await new Promise<RunStrixResult>((resolve) => {
    let settled = false
    const done = (r: RunStrixResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = doSpawn('strix', args, options)
    } catch (err) {
      done({ ok: false, code: 'STRIX_SPAWN_FAILED', reason: errText(err) })
      return
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      done({ ok: false, code: 'STRIX_TIMEOUT', reason: `exceeded ${input.timeoutSeconds}s` })
    }, input.timeoutSeconds * 1000)

    input.signal?.addEventListener('abort', () => {
      child.kill('SIGKILL')
      done({ ok: false, code: 'STRIX_TIMEOUT', reason: 'aborted' })
    })

    if (input.onLine && child.stdout) streamLines(child.stdout, (l) => input.onLine!(l, 'stdout'))
    if (input.onLine && child.stderr) streamLines(child.stderr, (l) => input.onLine!(l, 'stderr'))

    child.on('error', (err) => {
      done({ ok: false, code: 'STRIX_SPAWN_FAILED', reason: errText(err) })
    })

    child.on('close', async (exitCode) => {
      // A non-zero exit is EXPECTED when vulnerabilities are found — not a failure.
      const after = await listDirs(runsRoot)
      const fresh = after.filter((d) => !before.includes(d))
      const runDir =
        fresh.length > 0
          ? path.join(runsRoot, newest(fresh, runsRoot))
          : after.length > 0
            ? path.join(runsRoot, await newestByMtime(after, runsRoot))
            : null
      if (!runDir) {
        done({ ok: false, code: 'STRIX_NO_OUTPUT', reason: `no run directory under ${runsRoot}` })
        return
      }
      done({ ok: true, runDir, exitCode })
    })
  })
}

export interface StrixRunOutput {
  findings: Finding[]
  runName: string
  /** The JSON file the findings were parsed from, if any (for traceability). */
  sourceFile?: string
}

/**
 * Read a completed run directory and parse it into findings. Recursively scans for JSON report
 * files, preferring ones whose name hints at a report; a present-but-empty run yields zero findings
 * (a clean result), never an error.
 */
export async function readStrixRun(runDir: string): Promise<StrixRunOutput> {
  const runName = path.basename(runDir)
  const jsonFiles = await walkFiles(runDir, (f) => f.endsWith('.json'))
  jsonFiles.sort(reportNameFirst)

  for (const file of jsonFiles) {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'))
      const findings = parseStrixFindings(raw)
      if (findings.length > 0) return { findings, runName, sourceFile: file }
    } catch {
      // skip unparseable json
    }
  }
  // No JSON produced findings — the run is clean (or only logs/markdown exist).
  return { findings: [], runName }
}

// ── internals ────────────────────────────────────────────────────────────────

function streamLines(stream: NodeJS.ReadableStream, onLine: (l: string) => void): void {
  const rl = readline.createInterface({ input: stream })
  rl.on('line', (l) => {
    const trimmed = l.trim()
    if (trimmed) onLine(trimmed)
  })
}

async function listDirs(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

function newest(names: string[], _root: string): string {
  // Strix run names are timestamped; lexicographic max is the newest. Fallback to last.
  return [...names].sort().at(-1) ?? names[0]
}

async function newestByMtime(names: string[], root: string): Promise<string> {
  let best = names[0]
  let bestMtime = -Infinity
  for (const name of names) {
    try {
      const st = await fs.stat(path.join(root, name))
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs
        best = name
      }
    } catch {
      // ignore
    }
  }
  return best
}

async function walkFiles(dir: string, match: (f: string) => boolean): Promise<string[]> {
  const out: string[] = []
  async function walk(d: string): Promise<void> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else if (match(full)) out.push(full)
    }
  }
  await walk(dir)
  return out
}

function reportNameFirst(a: string, b: string): number {
  const score = (f: string) => (/(report|finding|vuln|result)/i.test(path.basename(f)) ? 0 : 1)
  return score(a) - score(b)
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
