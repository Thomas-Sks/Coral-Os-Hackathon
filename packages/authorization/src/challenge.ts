/**
 * Domain-control challenge.
 *
 * Proving *control* of a target (not merely claiming it) is the first half of consent. The buyer
 * publishes a random nonce at the target — either as `/.well-known/auditmesh-authz.txt` or a DNS
 * TXT record `auditmesh-authz=<nonce>` — and the verifier fetches it **live at request time**, so a
 * grant can't be replayed after the buyer loses control of the host. Network access is
 * dependency-injected so the checks are unit-testable without real DNS/HTTP.
 *
 * For the bundled demo, the compose front-door serves the well-known file, so this challenge passes
 * genuinely end-to-end against the self-hosted Juice Shop.
 */

import { randomBytes } from 'node:crypto'
import { promises as dns } from 'node:dns'
import {
  WELL_KNOWN_PATH,
  DNS_TXT_PREFIX,
  OwnershipProof,
  type OwnershipMethod,
} from '@auditmesh/shared'

/** A fresh challenge nonce (hex). 16 bytes = 128 bits, comfortably unguessable. */
export function generateNonce(bytes = 16): string {
  return randomBytes(bytes).toString('hex')
}

/** The absolute URL the well-known token is served from for a given target origin. */
export function wellKnownUrl(target: string): string {
  return new URL(WELL_KNOWN_PATH, ensureOrigin(target)).toString()
}

/** The exact bytes to serve at the well-known path (or place in the TXT record body). */
export function wellKnownBody(nonce: string): string {
  return `${DNS_TXT_PREFIX}${nonce}\n`
}

/** Build the {@link OwnershipProof} the buyer embeds in its signed payload. */
export function buildOwnershipProof(
  method: OwnershipMethod,
  nonce: string,
  target: string,
): OwnershipProof {
  const evidence =
    method === 'well-known' ? wellKnownUrl(target) : `TXT ${new URL(ensureOrigin(target)).hostname}`
  return OwnershipProof.parse({ method, nonce, evidence })
}

/** Injectable network for testing. Defaults hit the real network. */
export interface DomainControlDeps {
  /** Fetch the body of a URL as text. Should be no-store + time-limited. */
  fetchText?: (url: string) => Promise<string>
  /** Resolve TXT records for a hostname (array of chunk arrays, like dns.resolveTxt). */
  resolveTxt?: (hostname: string) => Promise<string[][]>
  /** Per-request timeout for the live fetch, ms. */
  timeoutMs?: number
}

export type DomainControlResult = { ok: true } | { ok: false; reason: string }

/**
 * Re-verify, live, that the challenge nonce is still published at the target. Called by the verifier
 * on every scan and every escrow release — a stale or removed token is a hard stop.
 */
export async function verifyDomainControl(
  proof: OwnershipProof,
  target: string,
  deps: DomainControlDeps = {},
): Promise<DomainControlResult> {
  const nonce = proof.nonce.trim()
  if (!nonce) return { ok: false, reason: 'empty nonce' }

  if (proof.method === 'well-known') {
    const url = wellKnownUrl(target)
    const fetchText = deps.fetchText ?? defaultFetchText(deps.timeoutMs ?? 5000)
    let body: string
    try {
      body = await fetchText(url)
    } catch (err) {
      return { ok: false, reason: `could not fetch ${url}: ${errText(err)}` }
    }
    return body.includes(nonce)
      ? { ok: true }
      : { ok: false, reason: `nonce not present at ${url}` }
  }

  // dns-txt
  const hostname = new URL(ensureOrigin(target)).hostname
  const resolveTxt = deps.resolveTxt ?? ((h: string) => dns.resolveTxt(h))
  let records: string[][]
  try {
    records = await resolveTxt(hostname)
  } catch (err) {
    return { ok: false, reason: `could not resolve TXT for ${hostname}: ${errText(err)}` }
  }
  const flat = records.map((chunks) => chunks.join(''))
  const expected = `${DNS_TXT_PREFIX}${nonce}`
  return flat.some((r) => r.trim() === expected)
    ? { ok: true }
    : { ok: false, reason: `no TXT record ${expected} on ${hostname}` }
}

function defaultFetchText(timeoutMs: number): (url: string) => Promise<string> {
  return async (url: string) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: { 'cache-control': 'no-cache' },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Accept a bare host or a full URL and return a usable origin base for URL construction. */
function ensureOrigin(target: string): string {
  if (/^https?:\/\//i.test(target)) return target
  return `http://${target}`
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
