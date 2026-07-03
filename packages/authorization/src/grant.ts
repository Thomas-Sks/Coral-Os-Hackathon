/**
 * Grant transport — encode a {@link SignedAuthorization} as one opaque, whitespace-free token so the
 * buyer can hand it to the seller over the CoralOS thread as `AUTHZ_GRANT round=<n> <token>`. This is
 * transport only; it neither signs nor trusts. The seller decodes and then runs the full verifier.
 */

import { SignedAuthorization } from '@auditmesh/shared'

/** base64url-encode a signed authorization (JSON → utf8 → base64url, no padding). */
export function encodeGrant(signed: SignedAuthorization): string {
  const json = JSON.stringify(SignedAuthorization.parse(signed))
  return Buffer.from(json, 'utf8').toString('base64url')
}

export type DecodeResult =
  | { ok: true; signed: SignedAuthorization }
  | { ok: false; reason: string }

/** Decode + schema-validate a grant token. Total — never throws; returns a reason on any failure. */
export function decodeGrant(token: string): DecodeResult {
  let json: string
  try {
    json = Buffer.from(token, 'base64url').toString('utf8')
  } catch (err) {
    return { ok: false, reason: `not base64url: ${errText(err)}` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    return { ok: false, reason: `not JSON: ${errText(err)}` }
  }
  const parsed = SignedAuthorization.safeParse(raw)
  return parsed.success
    ? { ok: true, signed: parsed.data }
    : { ok: false, reason: `failed schema: ${parsed.error.message}` }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
