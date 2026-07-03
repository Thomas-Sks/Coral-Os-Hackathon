# Quickstart — bare-metal 402 (no Docker, no CoralOS)

The fastest way in. The same pay-per-call idea as the full agent economy, but stripped to two
local Node processes and plain HTTP `402` — **no Docker, no coral-server**. Good for understanding
the payment loop before you bring CoralOS in.

```
buyer.ts  ──GET /api/data──▶  server.ts
          ◀──402 + Solana Pay──
   pays 0.0001 SOL on devnet
          ──GET /api/data (X-Payment: sig)──▶
          ◀──200 + data──  (server verified on-chain)
```

## Run

```sh
npm install
# the processes read plain env vars — export your generated wallet + (optional) Anthropic key:
export SELLER_WALLET=<devnet pubkey>            # or WALLET
export BUYER_KEYPAIR_B58=<base58 devnet keypair>
export ANTHROPIC_API_KEY=sk-ant-...             # optional — buyer skips the LLM step without it

npm run server   # terminal 1 — the 402 seller on :3001
npm run buyer    # terminal 2 — the LLM buyer pays, then gets data
```

(Generate + fund a wallet with `node ../../../scripts/setup.js` and the
[devnet faucet](https://faucet.solana.com).)

## The fork points

```
server.ts → deliverData()   — what the seller sells (default: a Jupiter swap quote)
verify.ts → verifyPayment()  — the on-chain check (recipient + amount)
buyer.ts                     — the LLM buyer's goal + budget guard
```

## Then graduate to CoralOS

This is the same economy without the coordination layer. When you're ready for agent discovery,
multi-agent sessions, and the human checkout front door, move up to the parent
[`agent-economy`](../README.md) track — same seller logic, now coordinated over coral-server.
