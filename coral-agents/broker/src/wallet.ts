import {
  Keypair,
  Transaction,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { solanaConnection } from '@pay/agent-runtime'

/** Load the broker keypair from BROKER_KEYPAIR_B58 (base58 64-byte, devnet-funded). */
function loadKeypair(): Keypair {
  const b58 = process.env.BROKER_KEYPAIR_B58
  if (!b58) throw new Error('BROKER_KEYPAIR_B58 not set')
  // Decode base58 via BigInt — avoids a bs58 dependency (same approach as buyer-agent).
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt(0)
  for (const c of b58) {
    const idx = ALPHABET.indexOf(c)
    if (idx < 0) throw new Error('Invalid base58 character')
    n = n * BigInt(58) + BigInt(idx)
  }
  const hex = n.toString(16).padStart(128, '0')
  const bytes = new Uint8Array(64)
  for (let i = 0; i < 64; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return Keypair.fromSecretKey(bytes)
}

export function getBrokerPublicKey(): string {
  return loadKeypair().publicKey.toBase58()
}

/** Pay a seller's Solana Pay URL from the broker wallet, writing the reference key in. */
export async function payFromUrl(solanaPayUrl: string, maxSol: number): Promise<string> {
  const raw = solanaPayUrl.replace(/^solana:/, 'solana://')
  const url = new URL(raw)
  const recipient = new PublicKey(url.hostname || url.pathname.replace(/^\/\//, ''))
  const amountSol = parseFloat(url.searchParams.get('amount') ?? '0')
  const reference = url.searchParams.get('reference')

  if (amountSol <= 0) throw new Error('Invalid amount in Solana Pay URL')
  if (amountSol > maxSol) throw new Error(`Amount ${amountSol} SOL exceeds broker budget ${maxSol} SOL`)

  const keypair = loadKeypair()
  const conn = solanaConnection()

  const ix = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: recipient,
    lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
  })
  if (reference) {
    ix.keys.push({ pubkey: new PublicKey(reference), isSigner: false, isWritable: false })
  }

  const tx = new Transaction().add(ix)
  const sig = await sendAndConfirmTransaction(conn, tx, [keypair], { commitment: 'confirmed' })
  console.error(`[broker] paid ${amountSol} SOL → ${recipient.toBase58()} sig=${sig}`)
  return sig
}
