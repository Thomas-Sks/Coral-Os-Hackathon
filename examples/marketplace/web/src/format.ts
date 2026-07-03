// Small presentation helpers shared across the redesigned dashboard.

/** Friendly names for the WANT `arg` short codes (e.g. `hdr+tls+xss`). */
export const SCOPE_LABEL: Record<string, string> = {
  hdr: 'Security Headers',
  tls: 'TLS Config',
  inj: 'Injection',
  xss: 'XSS',
  auth: 'Auth',
  ac: 'Access Control',
  data: 'Sensitive Data',
  dep: 'Dependencies',
  biz: 'Business Logic',
}

/** Decode a WANT `arg` (`hdr+tls+xss`) into labelled scope chips. Unknown codes pass through raw. */
export function scopeCodes(arg?: string): { code: string; label: string }[] {
  if (!arg) return []
  return arg
    .split('+')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((code) => ({ code, label: SCOPE_LABEL[code] ?? code }))
}

/** Format a SOL amount without float noise or trailing zeros (`0.000200` → `0.0002`). */
export function fmtSol(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  const s = n.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')
  return s || '0'
}

/** Truncate a long id/address to `abcd…wxyz` for compact monospace display. */
export function shortId(id: string, head = 6, tail = 4): string {
  if (!id) return ''
  return id.length > head + tail + 1 ? `${id.slice(0, head)}…${id.slice(-tail)}` : id
}
