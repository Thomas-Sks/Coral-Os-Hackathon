/**
 * The seller's bidding brain — persona-driven, code-enforced economics.
 *
 * On an `audit` WANT the seller decodes the requested scope, decides (per its persona) whether the
 * job fits, and — if so — asks the LLM for a price. The model PROPOSES; this code DISPOSES: it never
 * bids on a service it doesn't carry, never below its cost floor, never above the buyer's budget, and
 * a specialist sits out jobs outside its specialty. A prompt injection inside a WANT therefore can't
 * make a seller bid at a loss or outside its lane. Personas differ ONLY by config (env from the TOML).
 */
import {
  complete,
  parseJsonReply,
  type Want,
  type CompleteOpts,
} from '@pay/agent-runtime'
import {
  AUDIT_SERVICE,
  decodeScopeArg,
  ALL_TEST_CATEGORIES,
  TEST_CATEGORY_LABEL,
  type TestCategory,
} from '@auditmesh/shared'

export type Strategy = 'discount' | 'specialist' | 'premium'

export interface SellerConfig {
  name: string
  floorSol: number
  /** Test families this persona can assess. */
  offeredCategories: TestCategory[]
  /** How it prices + whether it declines out-of-lane jobs. */
  strategy: Strategy
  /** LLM system-prompt persona text. */
  persona: string
}

export interface BidDecision {
  bid: boolean
  priceSol: number
  note: string
}

/** Parse a csv of category short codes or full names into TestCategory[]. Empty ⇒ all categories. */
function parseCategories(raw: string | undefined): TestCategory[] {
  if (!raw || raw.trim() === '') return [...ALL_TEST_CATEGORIES]
  const short = decodeScopeArg(raw.replace(/,/g, '+'))
  const full = raw
    .split(/[,+]/)
    .map((s) => s.trim())
    .filter((s): s is TestCategory => (ALL_TEST_CATEGORIES as string[]).includes(s))
  const set = new Set<TestCategory>([...short, ...full])
  return set.size > 0 ? [...set] : [...ALL_TEST_CATEGORIES]
}

/** Build the persona from env (set per persona in coral-agent.toml). */
export function sellerConfigFromEnv(name: string): SellerConfig {
  const strategy = (process.env.STRATEGY ?? 'premium').toLowerCase() as Strategy
  return {
    name,
    floorSol: Number(process.env.FLOOR_SOL ?? '0.004'),
    offeredCategories: parseCategories(process.env.OFFERED_CATEGORIES),
    strategy: ['discount', 'specialist', 'premium'].includes(strategy) ? strategy : 'premium',
    persona:
      process.env.PERSONA ??
      'a security assessment seller competing in an autonomous marketplace',
  }
}

type Llm = (opts: CompleteOpts) => Promise<string>

/** Decide whether/how to bid on an audit WANT. `llm` is injectable so tests run offline. */
export async function decideBid(
  want: Want,
  cfg: SellerConfig,
  llm: Llm = complete,
): Promise<BidDecision> {
  // Hard guards first — no LLM call to refuse impossible jobs.
  if (want.service !== AUDIT_SERVICE) return { bid: false, priceSol: 0, note: 'not in inventory' }
  if (cfg.floorSol > want.budgetSol) return { bid: false, priceSol: 0, note: 'budget below floor' }

  const requested = decodeScopeArg(want.arg)
  const effective = requested.length > 0 ? requested : (['security-headers'] as TestCategory[])
  const covered = effective.filter((c) => cfg.offeredCategories.includes(c))
  const uncovered = effective.filter((c) => !cfg.offeredCategories.includes(c))

  // A specialist only competes when the whole job is inside its specialty.
  if (cfg.strategy === 'specialist' && uncovered.length > 0) {
    return { bid: false, priceSol: 0, note: 'outside specialty' }
  }
  if (covered.length === 0) return { bid: false, priceSol: 0, note: 'no covered categories' }

  const wantLabels = effective.map((c) => TEST_CATEGORY_LABEL[c]).join(', ')
  const system =
    `You are ${cfg.name}, ${cfg.persona}. You sell website security assessments and you are competing ` +
    `against other sellers for this job. Decide whether to bid and at what price in SOL. Your cost ` +
    `floor is ${cfg.floorSol} SOL — never below it; the buyer's budget caps the price. A ${cfg.strategy} ` +
    `seller prices ` + priceGuidance(cfg.strategy) +
    `. In "note", make a short persuasive PITCH (one sentence, under 20 words) arguing why the buyer ` +
    `should pick YOU over rivals — lean on your edge (price, focus, or depth). ` +
    `Reply ONLY with JSON: {"bid": boolean, "price": number, "note": string}.`
  const user =
    `service=${want.service} requested_scope=[${wantLabels}] budget=${want.budgetSol} floor=${cfg.floorSol} ` +
    `covered=${covered.length}/${effective.length}`

  let proposed: number | undefined
  let note = ''
  try {
    const parsed = parseJsonReply<{ bid?: boolean; price?: number; note?: string }>(
      await llm({ system, user, maxTokens: 200 }),
    )
    if (parsed) {
      if (parsed.bid === false) {
        return { bid: false, priceSol: 0, note: (parsed.note ?? 'declined').slice(0, 140) }
      }
      proposed = typeof parsed.price === 'number' ? parsed.price : undefined
      note = (parsed.note ?? '').slice(0, 140)
    }
  } catch {
    // LLM unavailable → deterministic fallback below (strategy-anchored price within bounds).
  }

  const anchor = fallbackPrice(cfg, want.budgetSol)
  const priceSol = clamp(proposed ?? anchor, cfg.floorSol, want.budgetSol)
  return {
    bid: true,
    priceSol: round4(priceSol),
    note: note || defaultNote(cfg.strategy, covered.length),
  }
}

function priceGuidance(s: Strategy): string {
  return s === 'discount'
    ? 'near the floor for a fast, minimal-scope pass'
    : s === 'specialist'
      ? 'aggressively but profitably for a focused, expert config review'
      : 'at a premium for the widest, deepest coverage'
}

/** Deterministic price anchor if the LLM is unavailable — keeps personas visibly distinct. */
function fallbackPrice(cfg: SellerConfig, budget: number): number {
  const span = Math.max(0, budget - cfg.floorSol)
  const frac = cfg.strategy === 'discount' ? 0.1 : cfg.strategy === 'specialist' ? 0.45 : 0.8
  return cfg.floorSol + span * frac
}

function defaultNote(s: Strategy, covered: number): string {
  return s === 'discount'
    ? 'fast minimal pass'
    : s === 'specialist'
      ? 'focused expert review'
      : `full audit, ${covered} families`
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round4 = (n: number) => Math.round(n * 1e4) / 1e4
