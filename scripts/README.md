# scripts

Helper scripts for the kit.

## `setup.js` — one-time wallet setup

```sh
npm install --prefix scripts
node scripts/setup.js
```

Generates a buyer + seller devnet keypair, writes them into the repo-root `.env` (filling
`WALLET` and `BUYER_KEYPAIR_B58` from `.env.example`), and prints both addresses to **fund** at
[faucet.solana.com](https://faucet.solana.com). Re-running re-reads your `.env`, so it preserves a key
(e.g. `ANTHROPIC_API_KEY`) you've already added.

## `txodds.js` — run the demo

```sh
npm run dev        # = node scripts/txodds.js
```

Starts the data/escrow proxy (:8801) + the Oracle UI (:3020) and opens the browser. Devnet only.
