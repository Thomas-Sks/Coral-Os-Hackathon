/**
 * One-time mint for the World Cup demo (optional).
 *
 * Subscribes the kit's buyer wallet to the FREE World Cup tier on devnet, activates an API token, and
 * writes it into the repo `.env` as `TXLINE_API_KEY` — for the standalone `TxLineClient`. The running
 * demo's proxy subscribes on its own, so you don't need this to `npm run dev`.
 *
 *   cd examples/txodds && npm install && npm run mint
 *
 * The token is short-lived (devnet free tier), so re-run before a demo. Corrections vs. the published
 * TxODDS examples are baked in: host txline-dev.txodds.com, the real treasury mint, legacy subscribe.
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import * as anchor from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Keypair, Connection } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { assertDevnet } from '@pay/agent-runtime'

const PROGRAM = new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J')
const MINT = new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG') // real treasury mint
const BASE = process.env.TXLINE_BASE_URL || 'https://txline-dev.txodds.com'
const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const ENV_PATH = process.env.KIT_ENV || fileURLToPath(new URL('../../../.env', import.meta.url))

function buyerKeypair(): Keypair {
  const txt = fs.readFileSync(ENV_PATH, 'utf8')
  const m = txt.match(/^BUYER_KEYPAIR_B58=(.+)$/m)
  if (!m) throw new Error(`BUYER_KEYPAIR_B58 not in ${ENV_PATH} — run: node scripts/setup.js`)
  return Keypair.fromSecretKey(bs58.decode(m[1].trim()))
}

function setKv(env: string, k: string, v: string): string {
  const re = new RegExp(`^${k}=.*$`, 'm')
  return re.test(env) ? env.replace(re, `${k}=${v}`) : `${env.replace(/\s*$/, '\n')}${k}=${v}\n`
}

async function main(): Promise<void> {
  const keypair = buyerKeypair()
  assertDevnet(RPC) // devnet-only: refuse a mainnet RPC unless ALLOW_MAINNET=1
  const connection = new Connection(RPC, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' })
  const idl = (await anchor.Program.fetchIdl(PROGRAM, provider)) as anchor.Idl
  const program = new anchor.Program(idl, provider)

  const jwt = (await axios.post(`${BASE}/auth/guest/start`)).data.token
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, keypair, MINT, keypair.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  )
  const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], PROGRAM)
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], PROGRAM)
  const tokenTreasuryVault = getAssociatedTokenAddressSync(MINT, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID)

  console.error('[mint] subscribing to the free World Cup tier on devnet…')
  const txSig = await (program.methods as Record<string, (...args: number[]) => { accounts: (a: Record<string, PublicKey>) => { rpc: () => Promise<string> } }>)
    .subscribe(1, 4)
    .accounts({
      user: keypair.publicKey, pricingMatrix, tokenMint: MINT, userTokenAccount: ata.address,
      tokenTreasuryVault, tokenTreasuryPda, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc()

  const message = new TextEncoder().encode(`${txSig}::${jwt}`)
  const walletSignature = Buffer.from(nacl.sign.detached(message, keypair.secretKey)).toString('base64')
  const data = (await axios.post(
    `${BASE}/api/token/activate`,
    { txSig, walletSignature, leagues: [] },
    { headers: { Authorization: `Bearer ${jwt}` } },
  )).data
  const token: unknown = data.token || data
  if (typeof token !== 'string' || !token) throw new Error('activation returned no token')

  // List a few current fixtures with odds, so you can sanity-check the free tier is live.
  const fixtures = (await axios.get(`${BASE}/api/fixtures/snapshot`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': token },
  })).data as Array<{ FixtureId: number; Competition: string; Participant1: string; Participant2: string }>
  const all = Array.isArray(fixtures) ? fixtures : []
  const candidates = all.filter((f) => f.Competition === 'World Cup').length
    ? all.filter((f) => f.Competition === 'World Cup')
    : all
  // Keep only fixtures that actually have a 1X2 odds market, so every demo round shows a full board.
  const pick: typeof candidates = []
  for (const f of candidates) {
    if (pick.length >= 5) break
    try {
      const o = (await axios.get(`${BASE}/api/odds/snapshot/${f.FixtureId}`, {
        headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': token },
      })).data
      if (Array.isArray(o) && o.some((x: { SuperOddsType?: string }) => String(x.SuperOddsType ?? '').includes('1X2'))) pick.push(f)
    } catch { /* skip fixtures without odds */ }
  }
  if (pick.length === 0) throw new Error('no fixtures with odds — the free tier may be inactive')

  let env = fs.readFileSync(ENV_PATH, 'utf8')
  env = setKv(env, 'TXLINE_API_KEY', token)
  fs.writeFileSync(ENV_PATH, env)

  console.error('[mint] ✓ TXLINE_API_KEY written to .env')
  console.error(`[mint]   ${pick.length} fixtures currently carry 1X2 odds:`)
  for (const f of pick) console.error(`[mint]     ${f.FixtureId}  ${f.Participant1} v ${f.Participant2}`)
  console.error('[mint]   next: `npm run dev`  (proxy + Oracle UI), or `npm run web` to open the board')
}

main().catch((e) => { console.error('[mint] failed:', (e as Error).message); process.exit(1) })
