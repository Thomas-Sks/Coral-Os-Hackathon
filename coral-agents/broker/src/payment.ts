import { PublicKey, Keypair } from '@solana/web3.js'
import { encodeURL, validateTransfer } from '@solana/pay'
import BigNumber from 'bignumber.js'
import { solanaConnection } from '@pay/agent-runtime'

const connection = () => solanaConnection()

/**
 * The broker is a SELLER to the buyer: it charges `amountSol` (its cost + markup) to its own wallet
 * (`SELLER_WALLET`), tagged with a unique reference. Mirrors seller-agent/payment.ts, but the amount
 * is dynamic (per-order) instead of a fixed PRICE_SOL.
 */
export function generatePaymentUrl(request: string, amountSol: number) {
  const recipient = process.env.SELLER_WALLET // the broker's receive wallet
  if (!recipient) throw new Error('SELLER_WALLET (broker receive wallet) not set')
  const reference = Keypair.generate().publicKey

  const url = encodeURL({
    recipient: new PublicKey(recipient),
    amount: new BigNumber(amountSol),
    reference,
    label: 'Broker',
    message: request.slice(0, 100),
  })

  return { url: url.toString(), reference: reference.toBase58(), amountSol }
}

/** Verify the buyer paid `amountSol` to the broker wallet, carrying `reference`. */
export async function verifyPayment(sig: string, reference: string, amountSol: number): Promise<boolean> {
  try {
    await validateTransfer(
      connection(),
      sig,
      {
        recipient: new PublicKey(process.env.SELLER_WALLET!),
        amount: new BigNumber(amountSol),
        reference: new PublicKey(reference),
      },
      { commitment: 'confirmed' },
    )
    return true
  } catch (e) {
    console.error(`[broker] payment verify failed: ${e}`)
    return false
  }
}
