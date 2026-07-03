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
  estimateScanCost,
  priceFromCost,
  MARGIN_BY_STRATEGY,
  type TestCategory,
  type ScanMode,
} from '@auditmesh/shared'

export type Strategy = 'discount' | 'specialist' | 'premium'

// Market-wide economics, injected via env so the whole session shares one basis.
const SOL_EUR = Number(process.env.SOL_EUR ?? '71')
const LLM_EUR_PER_MTOKEN = Number(process.env.LLM_EUR_PER_MTOKEN ?? '0.2') // DeepSeek blended

export interface SellerConfig {
  name: string
  floorSol: number
  /** Test families this persona can assess. */
  offeredCategories: TestCategory[]
  /** How it prices + whether it declines out-of-lane jobs. */
  strategy: Strategy
  /** Scan depth this persona delivers — drives its token cost (quick | standard | deep). */
  scanMode: ScanMode
  /** Token-efficiency multiplier of this persona's engine (lower = leaner). */
  efficiency: number
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
  const mode = (process.env.SCAN_MODE ?? 'quick').toLowerCase()
  return {
    name,
    floorSol: Number(process.env.FLOOR_SOL ?? '0.006'),
    offeredCategories: parseCategories(process.env.OFFERED_CATEGORIES),
    strategy: ['discount', 'specialist', 'premium'].includes(strategy) ? strategy : 'premium',
    scanMode: (['quick', 'standard', 'deep'].includes(mode) ? mode : 'quick') as ScanMode,
    efficiency: Number(process.env.SCAN_EFFICIENCY ?? '1'),
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

  // Dynamic COGS: estimate the tokens Strix will burn on THIS site at THIS depth, then price it.
  const { costEur, expectedTokens } = estimateScanCost({
    mode: cfg.scanMode,
    surface: want.surface,
    efficiency: cfg.efficiency,
    llmEurPerMToken: LLM_EUR_PER_MTOKEN,
  })
  const breakEvenSol = round4(costEur / SOL_EUR)
  if (breakEvenSol > want.budgetSol) {
    return { bid: false, priceSol: 0, note: `budget below scan cost (~${breakEvenSol} SOL) for ${cfg.scanMode} depth` }
  }
  const margin = MARGIN_BY_STRATEGY[cfg.strategy] ?? 2.4
  const priceSol = priceFromCost({ costEur, margin, solEur: SOL_EUR, floorSol: cfg.floorSol, budgetSol: want.budgetSol })

  // The PRICE is the deterministic cost estimate above; the LLM only writes the pitch (and may decline).
  const wantLabels = effective.map((c) => TEST_CATEGORY_LABEL[c]).join(', ')
  const siteDesc = want.surface
    ? `${want.surface.pages} pages / ${want.surface.forms} forms / ${want.surface.endpoints} endpoints`
    : 'unspecified size'
  const system =
    `You are ${cfg.name}, ${cfg.persona}. You sell website security assessments and compete against ` +
    `other sellers. Your price for THIS job is already set at ${priceSol} SOL — it covers your real scan ` +
    `cost (a ${cfg.scanMode} scan of a ${siteDesc} site, ~${(expectedTokens / 1e6).toFixed(1)}M LLM tokens). ` +
    `Decide only whether to bid (yes if it fits your lane), and write a short persuasive PITCH (one ` +
    `sentence, under 20 words) for why the buyer should pick YOU — lean on your edge (price, focus, depth). ` +
    `Reply ONLY with JSON: {"bid": boolean, "note": string}.`
  const user =
    `service=${want.service} requested_scope=[${wantLabels}] your_price=${priceSol} depth=${cfg.scanMode} ` +
    `site=[${siteDesc}] est_tokens=${(expectedTokens / 1e6).toFixed(1)}M covered=${covered.length}/${effective.length}`

  let note = ''
  try {
    const parsed = parseJsonReply<{ bid?: boolean; note?: string }>(
      await llm({ system, user, maxTokens: 160 }),
    )
    if (parsed) {
      if (parsed.bid === false) {
        return { bid: false, priceSol: 0, note: (parsed.note ?? 'declined').slice(0, 140) }
      }
      note = (parsed.note ?? '').slice(0, 140)
    }
  } catch {
    // LLM unavailable → keep the cost-based price and a deterministic note.
  }

  return {
    bid: true,
    priceSol: round4(priceSol),
    note: note || defaultNote(cfg.strategy, covered.length),
  }
}

function defaultNote(s: Strategy, covered: number): string {
  return s === 'discount'
    ? 'fast minimal pass'
    : s === 'specialist'
      ? 'focused expert review'
      : `full audit, ${covered} families`
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4
