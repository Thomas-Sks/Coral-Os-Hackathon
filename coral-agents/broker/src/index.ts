/**
 * Broker agent — the swarm coordinator. It is BOTH a buyer and a seller:
 *
 *   buyer ──"request <service>"──▶ broker
 *     broker quotes every seller in SWARM_SELLERS (each in its own thread)
 *     broker buys from the cheapest          (broker PAYS the seller on-chain)
 *     broker resells to the buyer at +MARKUP (buyer PAYS the broker on-chain)
 *
 * Two on-chain settlements per request; the broker keeps the spread. Reuses the kit's
 * seller payment.ts (to charge the buyer) and a buyer-style wallet.ts (to pay sellers).
 *
 * Env: BROKER_KEYPAIR_B58 (pays sellers), SELLER_WALLET (= broker pubkey, receives from buyer),
 *      SWARM_SELLERS (csv), MARKUP, BROKER_MAX_SOL, SOLANA_RPC_URL.
 */
import { startCoralAgent } from '@pay/agent-runtime'
import { generatePaymentUrl, verifyPayment } from './payment.js'
import { payFromUrl, getBrokerPublicKey } from './wallet.js'
import { type Quote, parsePaymentRequired, pickCheapest } from './logic.js'

const SELLERS = (process.env.SWARM_SELLERS || 'seller-cheap,seller-premium')
  .split(',').map((s) => s.trim()).filter(Boolean)
const MARKUP = parseFloat(process.env.MARKUP ?? '1.2')
const MAX_SOL = parseFloat(process.env.BROKER_MAX_SOL ?? '0.01')

await startCoralAgent({ agentName: 'broker' }, async (ctx) => {
  console.error(`[broker] wallet ${getBrokerPublicKey()} | sellers=${SELLERS.join(',')} | markup=${MARKUP}`)

  while (true) {
   try {
    const ask = await ctx.waitForMention(30_000)
    if (!ask || !/^request/i.test(ask.text.trim())) continue
    const buyerThread = ask.threadId
    const buyer = ask.sender ? [ask.sender] : []
    const service = ask.text.trim().replace(/^request\s*/i, '').trim() || 'jupiter'
    console.error(`[broker] buyer wants "${service}" — shopping ${SELLERS.length} sellers`)

    // 1. Quote every seller (each in its own thread).
    const quotes: Quote[] = []
    for (const seller of SELLERS) {
      try {
        const thread = await ctx.createThread(`broker-${seller}-${Date.now()}`, [seller])
        await ctx.send(`request ${service}`, thread, [seller])
        const reply = await ctx.waitForMentionInThread(thread, 45_000)
        const q = reply && parsePaymentRequired(reply.text)
        if (q) {
          quotes.push({ seller, thread, ...q })
          console.error(`[broker]   ${seller}: ${q.amount} SOL`)
        } else {
          console.error(`[broker]   ${seller}: no quote`)
        }
      } catch (e) {
        console.error(`[broker]   ${seller} error: ${e}`)
      }
    }
    if (quotes.length === 0) {
      if (buyerThread) await ctx.send('NO_SELLERS_AVAILABLE', buyerThread, buyer)
      continue
    }

    // 2. Buy from the cheapest seller (broker PAYS on-chain).
    const best = pickCheapest(quotes)!
    console.error(`[broker] cheapest = ${best.seller} @ ${best.amount} SOL — buying`)
    let data: string
    try {
      const sig = await payFromUrl(best.url, MAX_SOL)
      await ctx.send(`paid ${sig} reference=${best.reference}`, best.thread, [best.seller])
      const delivered = await ctx.waitForMentionInThread(best.thread, 45_000)
      if (!delivered || !/DELIVERED/i.test(delivered.text)) throw new Error('seller did not deliver')
      data = delivered.text.replace(/^[\s\S]*?DELIVERED\s*/i, '').trim()
    } catch (e) {
      console.error(`[broker] upstream buy failed: ${e}`)
      if (buyerThread) await ctx.send('UPSTREAM_FAILED', buyerThread, buyer)
      continue
    }

    // 3. Resell to the buyer at a markup (buyer PAYS the broker).
    const price = +(best.amount * MARKUP).toFixed(6)
    const charge = generatePaymentUrl(service, price)
    console.error(`[broker] reselling @ ${price} SOL (cost ${best.amount} from ${best.seller}, margin ${(price - best.amount).toFixed(6)})`)
    await ctx.reply(ask, `PAYMENT_REQUIRED reference=${charge.reference} amount=${charge.amountSol} url=${charge.url} via=${best.seller}`)

    if (!buyerThread) continue
    const proof = await ctx.waitForMentionInThread(buyerThread, 120_000)
    const buyerSig = proof?.text.match(/paid\s+(\S+)/)?.[1]
    if (proof && buyerSig && (await verifyPayment(buyerSig, charge.reference, charge.amountSol))) {
      await ctx.reply(proof, `DELIVERED ${data}`)
      console.error('[broker] delivered to buyer ✓')
    } else {
      console.error('[broker] buyer payment not verified')
      await ctx.reply(ask, 'PAYMENT_NOT_VERIFIED')
    }
   } catch (e) {
     console.error(`[broker] cycle error: ${e}`)
     await new Promise((r) => setTimeout(r, 2000))
   }
  }
})
