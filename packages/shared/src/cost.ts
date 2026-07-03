/**
 * Scan cost model.
 *
 * A seller's real COGS is the LLM tokens Strix burns — and that scales with the target's attack surface
 * and the scan depth, not with a flat number. This turns a hardcoded floor into a dynamic, defensible
 * price: the bid tracks the real size of *this* job on *this* site.
 *
 *   expectedTokens = BASE[mode] × (1 + surfaceScore / K) × efficiency
 *   costEur        = expectedTokens × llmEurPerMToken
 *   priceSol       = max(floor, costEur × margin / solEur)   (capped at budget)
 */

import type { ScanMode } from './config.js'

/** Structural surface shape — matches the market's SurfaceProfile without importing it (avoids a dep cycle). */
export interface SurfaceLike {
  pages: number
  forms: number
  endpoints: number
  params?: number
}

/** Baseline tokens a scan burns on a minimal site, before the surface multiplier. */
export const BASE_TOKENS: Record<ScanMode, number> = {
  quick: 0.5e6,
  standard: 1.5e6,
  deep: 4e6,
}

/** Normalization for the surface multiplier (higher ⇒ surface matters less). Tuned so Juice Shop ≈ 2–3×. */
export const SURFACE_K = 60

/** Weighted attack-surface units — forms & endpoints cost more to probe than static pages. */
export function surfaceScore(s: SurfaceLike): number {
  return s.pages + 2 * s.forms + 2 * s.endpoints + 0.1 * (s.params ?? 0)
}

export interface ScanCostInput {
  mode: ScanMode
  surface?: SurfaceLike
  /** Persona efficiency multiplier on tokens (lower = leaner engine). Default 1. */
  efficiency?: number
  /** Blended LLM price in EUR per million tokens. Default DeepSeek ≈ 0.20. */
  llmEurPerMToken?: number
}

export interface ScanCost {
  expectedTokens: number
  costEur: number
}

/** Estimate the scan's token burn and EUR cost from the target profile + depth. */
export function estimateScanCost(input: ScanCostInput): ScanCost {
  const { mode, surface, efficiency = 1, llmEurPerMToken = 0.2 } = input
  const factor = surface ? 1 + surfaceScore(surface) / SURFACE_K : 1
  const expectedTokens = BASE_TOKENS[mode] * factor * Math.max(0.1, efficiency)
  const costEur = (expectedTokens / 1_000_000) * llmEurPerMToken
  return { expectedTokens, costEur }
}

/** Convert a EUR cost into a SOL price with margin — floored, and (optionally) capped at the budget. */
export function priceFromCost(opts: {
  costEur: number
  margin: number
  solEur: number
  floorSol: number
  budgetSol?: number
}): number {
  const raw = (opts.costEur * opts.margin) / opts.solEur
  let price = Math.max(opts.floorSol, raw)
  if (opts.budgetSol != null) price = Math.min(price, opts.budgetSol)
  return Math.round(price * 1e4) / 1e4 // 4dp — a readable SOL price
}

/** Margin multiplier a persona applies on top of its COGS (its risk/quality premium). */
export const MARGIN_BY_STRATEGY: Record<string, number> = {
  discount: 2.0,
  specialist: 2.4,
  premium: 2.6,
}
