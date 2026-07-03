// Pure broker logic, extracted so it's unit-testable (index.ts runs startCoralAgent at import,
// which would try to connect to CoralOS).

export interface Quote {
  seller: string
  thread: string
  amount: number
  reference: string
  url: string
}

/** Parse a seller's `PAYMENT_REQUIRED reference=… amount=… url=solana:…` reply. */
export function parsePaymentRequired(text: string): Omit<Quote, 'seller' | 'thread'> | null {
  const amount = parseFloat(text.match(/amount=([\d.]+)/)?.[1] ?? '')
  const reference = text.match(/reference=([1-9A-HJ-NP-Za-km-z]{32,44})/)?.[1]
  const url = text.match(/url=(solana:[^\s"\\]+)/)?.[1]
  if (!amount || !reference || !url) return null
  return { amount, reference, url }
}

/** The broker's choice: the cheapest quote (does not mutate the input). */
export function pickCheapest(quotes: Quote[]): Quote | undefined {
  return [...quotes].sort((a, b) => a.amount - b.amount)[0]
}
