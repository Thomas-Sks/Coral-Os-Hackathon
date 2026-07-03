// Visual identity for every agent that appears on the floor. One helper, reused everywhere an
// agent is shown (rail, negotiation pitches, bid rows, verdict) so a persona always reads the same:
// an emoji avatar in a colored ring, a friendly label, and an accent color.

export interface Persona {
  /** The raw agent name it was derived from (kept for data attributes / tooltips). */
  key: string
  emoji: string
  label: string
  color: string
}

/** The canonical AuditMesh cast — exact identities from the market's personas. */
const KNOWN: Record<string, Omit<Persona, 'key'>> = {
  'audit-buyer': { emoji: '🧑‍💼', label: 'Buyer', color: '#6D5EF6' },
  'audit-discounter': { emoji: '💸', label: 'Budget Scanner', color: '#12A594' },
  'audit-tls-specialist': { emoji: '🔒', label: 'Config Specialist', color: '#5B5BD6' },
  'audit-premium': { emoji: '🛡️', label: 'Full-Audit Premium', color: '#F5A524' },
}

/** Deterministic accent palette for agents we don't have a hand-tuned identity for. */
const PALETTE = ['#6D5EF6', '#12A594', '#5B5BD6', '#F5A524', '#0EA5E9', '#DB2777', '#7C3AED', '#059669']

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = (Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0)
  return h >>> 0
}

/** Turn `seller-tls-specialist` into `Tls Specialist` for a legible fallback label. */
function titleize(name: string): string {
  const cleaned = name
    .replace(/^(seller|buyer|audit|agent)[-_]?/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  return cleaned || name
}

/**
 * Resolve any agent name to a stable visual identity. Known personas are exact; unknown/legacy
 * names (e.g. the recorded transcript's `seller-cheap`) are matched by keyword to the closest
 * archetype, then fall back to a deterministic color + friendly title.
 */
export function persona(name: string): Persona {
  const key = (name ?? '').trim()
  const lower = key.toLowerCase()
  if (KNOWN[lower]) return { key, ...KNOWN[lower] }

  const has = (...needles: string[]) => needles.some((n) => lower.includes(n))

  if (has('buyer', 'client')) return { key, emoji: '🧑‍💼', label: 'Buyer', color: '#6D5EF6' }
  if (has('cheap', 'discount', 'budget', 'lazy', 'coin')) return { key, emoji: '💸', label: 'Budget Scanner', color: '#12A594' }
  if (has('tls', 'net', 'config', 'header', 'hdr')) return { key, emoji: '🔒', label: 'Config Specialist', color: '#5B5BD6' }
  if (has('premium', 'full', 'appsec', 'enterprise', 'pro')) return { key, emoji: '🛡️', label: 'Full-Audit Premium', color: '#F5A524' }

  const color = key ? PALETTE[hash(lower) % PALETTE.length] : '#8A90A2'
  return { key, emoji: '🔍', label: titleize(key) || 'Agent', color }
}

/** The single buyer identity for a market (the WANT carries no agent name). */
export const BUYER = persona('audit-buyer')
