/**
 * TxODDS-only seller service.
 *
 * The CoralOS demo sells one thing: a verified TxLINE fair-line read for a fixture. Generic legacy
 * services were useful scaffolding, but they dilute the market story and are intentionally not routed
 * here anymore.
 */
import { complete, parseJsonReply } from '@pay/agent-runtime'

const TXLINE_BASE = process.env.TXLINE_BASE_URL || 'https://txline-dev.txodds.com'

export async function deliverService(request: string): Promise<string> {
  const [first, ...rest] = request.trim().split(/\s+/).filter(Boolean)
  const service = (first ?? 'txline').toLowerCase()
  if (service !== 'txline') {
    return JSON.stringify({ error: 'unsupported service', service, supported: ['txline'] })
  }
  return txlineService(rest.join(' '))
}

async function txlineGet(path: string): Promise<unknown> {
  const apiToken = process.env.TXLINE_API_KEY
  if (!apiToken) return { error: 'TXLINE_API_KEY not set - run the one-time subscribe (see examples/txodds)' }
  const auth = await fetch(`${TXLINE_BASE}/auth/guest/start`, { method: 'POST' })
  if (!auth.ok) return { error: `txline auth ${auth.status}` }
  const jwt = ((await auth.json()) as { token: string }).token
  const res = await fetch(`${TXLINE_BASE}${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  })
  if (!res.ok) return { error: `txline ${path} ${res.status}` }
  return res.json()
}

async function txlineService(request: string): Promise<string> {
  const tokens = request.trim().split(/\s+/).filter(Boolean)
  let action = (tokens[0] ?? 'fixtures').toLowerCase()
  let fixtureId = tokens[1]
  if (/^\d+$/.test(action)) {
    fixtureId = action
    action = 'edge'
  }

  switch (action) {
    case 'odds':
      return JSON.stringify({ service: 'txline-odds', fixtureId, odds: await txlineGet(`/api/odds/snapshot/${fixtureId}`) })
    case 'edge':
      return txlineEdge(fixtureId)
    case 'fixtures':
    default: {
      const fixtures = await txlineGet('/api/fixtures/snapshot')
      const list = Array.isArray(fixtures) ? fixtures : []
      return JSON.stringify({ service: 'txline-fixtures', count: list.length, fixtures: list.slice(0, 10) })
    }
  }
}

async function txlineEdge(fixtureId: string | undefined): Promise<string> {
  const [odds, fixtures] = await Promise.all([
    txlineGet(`/api/odds/snapshot/${fixtureId}`),
    txlineGet('/api/fixtures/snapshot'),
  ])
  const market = Array.isArray(odds)
    ? (odds as Array<Record<string, unknown>>).find((x) => String(x.SuperOddsType ?? '').includes('1X2'))
    : undefined
  const fx = Array.isArray(fixtures)
    ? (fixtures as Array<Record<string, unknown>>).find((f) => String(f.FixtureId) === String(fixtureId))
    : undefined
  const teams = fx ? { home: fx.Participant1, away: fx.Participant2, competition: fx.Competition } : undefined
  const matchup = teams ? `${teams.home} v ${teams.away}` : `fixture ${fixtureId}`

  const analysis = await liveReadOrFallback(matchup, odds, market, teams)
  return JSON.stringify({ service: 'txline-edge', fixtureId, teams, market, analysis })
}

async function liveReadOrFallback(
  matchup: string,
  odds: unknown,
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
): Promise<unknown> {
  try {
    const text = await complete({
      system: 'You are a football trading analyst. Reply only as JSON {"call": string, "confidence": number}.',
      user:
        `For ${matchup}, make a one-line value read from these de-margined World Cup odds. ` +
        `Odds: ${JSON.stringify(odds).slice(0, 1500)}`,
      maxTokens: 180,
    })
    return parseJsonReply(text) ?? { call: text }
  } catch (e) {
    return deterministicRead(market, teams, (e as Error).message)
  }
}

function deterministicRead(
  market: Record<string, unknown> | undefined,
  teams: Record<string, unknown> | undefined,
  reason: string,
): unknown {
  const names = (market?.PriceNames ?? []) as string[]
  const pcts = (market?.Pct ?? []) as string[]
  let bestIndex = -1
  let bestPct = -1
  names.forEach((_, i) => {
    const pct = Number(pcts[i])
    if (Number.isFinite(pct) && pct > bestPct) {
      bestPct = pct
      bestIndex = i
    }
  })
  if (bestIndex < 0) return { call: 'odds unavailable', note: `deterministic fallback: ${reason}` }
  const raw = names[bestIndex]
  const label = raw === 'part1'
    ? (teams?.home ?? 'Home')
    : raw === 'part2'
      ? (teams?.away ?? 'Away')
      : 'Draw'
  return {
    call: `Odds favour ${label} (${bestPct.toFixed(0)}%)`,
    confidence: Number((bestPct / 100).toFixed(2)),
    note: `deterministic fallback: ${reason}`,
  }
}
