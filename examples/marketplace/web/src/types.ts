// The feed server's API contract (mirrors marketplace-feed's Round). Kept here so the browser bundle
// never imports the node-side runtime/anchor/web3 code.

export interface RoundBid {
  by: string
  priceSol: number
  note?: string
}

export type RoundStatus = 'bidding' | 'awarded' | 'deposited' | 'delivered' | 'settled' | 'refunded'

/** The on-chain-enforced consent verdict (AUTHZ_RESULT). Drives the authorization badge. */
export interface RoundAuthz {
  hash: string
  status: 'verified' | 'rejected'
  code?: string
  detail?: string
}

/** One specialist sub-agent's progress within delivery (recon → analysis → reporting). */
export interface RoundDeliveryStage {
  stage: 'recon' | 'analysis' | 'reporting'
  status: 'active' | 'done' | 'error'
  note?: string
  pct?: number
}

export interface RoundDelivery {
  stages: RoundDeliveryStage[]
}

export interface Round {
  round: number
  want?: { service: string; arg: string; budgetSol: number }
  bids: RoundBid[]
  declined: string[]
  award?: { to: string; reason?: string }
  authz?: RoundAuthz
  escrow?: { reference: string; seller: string; amountSol: number; deadlineSecs: number }
  deposit?: { sig: string; buyer: string }
  delivery?: RoundDelivery
  delivered?: { raw: string; data?: unknown }
  release?: { sig: string }
  refunded?: boolean
  status: RoundStatus
}

export interface Feed {
  session: string
  rounds: Round[]
  updatedAt: string
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
export const explorerAddress = (addr: string) => `https://explorer.solana.com/address/${addr}?cluster=devnet`
