/**
 * Prebaked report loader (the `prebaked` path).
 *
 * `prebaked` mode replays a REAL, previously-generated Strix report so a filmed 3-minute demo is
 * deterministic. It is not fake data — it is an authentic report stored as our schema JSON; the only
 * thing prebaked changes is *when* the scan ran. Settlement still executes live on devnet regardless.
 *
 * The stored file is a full {@link AuditReport}; we return its real findings, and the pipeline re-
 * stamps them with the live deal's correlation id, target, scope, and timestamp via `buildReport`.
 */

import { promises as fs } from 'node:fs'
import { AuditReport, type Finding } from '@auditmesh/shared'

export type LoadPrebakedResult =
  | { ok: true; findings: Finding[] }
  | { ok: false; reason: string }

/** Read + validate the stored real Strix report and return its findings. Never throws. */
export async function loadPrebakedFindings(filePath: string): Promise<LoadPrebakedResult> {
  let text: string
  try {
    text = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    return { ok: false, reason: `could not read prebaked report at ${filePath}: ${errText(err)}` }
  }
  try {
    const report = AuditReport.parse(JSON.parse(text))
    return { ok: true, findings: report.findings }
  } catch (err) {
    return { ok: false, reason: `prebaked report failed schema: ${errText(err)}` }
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
