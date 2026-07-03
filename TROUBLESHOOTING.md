# Troubleshooting

The demo is just two Node processes (a proxy + a static web server) — **no Docker, no coral-server**.
Most issues are a missing LLM key, an unfunded wallet, or the free TxODDS tier being quiet.

---

## Setup & toolchain

### `Cannot find module '@solana/web3.js'` running `scripts/setup.js`
The `scripts/` deps aren't installed: `npm install --prefix scripts`, then retry.

### `npm run dev` says "Node 20+ required"
The kit targets Node 20+. Install it from [nodejs.org](https://nodejs.org), reopen your terminal, retry.

---

## Funding (the #1 blocker)

### "Where are my wallet addresses?"
After `node scripts/setup.js` they're printed **and saved to `WALLETS.txt`**. Re-run it anytime to reprint.

### The faucet won't give me SOL / "rate limited"
[faucet.solana.com](https://faucet.solana.com) is the **only** way (CLI/RPC `airdrop` is gated). It
needs **GitHub sign-in** and rate-limits per account. Request a small amount — a deposit is ~0.0002 SOL,
so 1 SOL lasts a long time. Fund the **buyer** wallet (it signs the escrow); devnet SOL persists.

---

## The board shows "sample fixtures" instead of live odds

The board renders only fixtures that currently have **verified live odds**. The free World Cup tier's
odds are intermittent, so:

- **On a fresh start** the proxy needs a few seconds to subscribe on devnet. The page keeps polling and
  switches to live on its own — give it ~10–20s.
- **If it stays on sample data**, the tier genuinely has no priced markets right now. The board goes
  live automatically when odds return; you don't need to restart anything.
- **Check directly:** `curl http://localhost:8801/api/board` — a non-empty array means live data is
  flowing. `[]` means no priced markets at the moment.

### The proxy log shows a subscribe/auth error
The proxy needs a funded `BUYER_KEYPAIR_B58` in the repo `.env` and the TxLINE dev host
(`txline-dev.txodds.com`) reachable. Fund the buyer wallet, then restart `npm run dev`. The page still
renders clearly-labelled sample data while the proxy is unavailable.

---

## The agent's call says "deterministic" instead of "LLM"

The LLM call failed and fell back to the deterministic pick. Almost always the API key:

- No key, or the wrong one, in `.env` — the kit's LLM is **Venice AI** (`LLM_PROVIDER=venice` +
  `VENICE_API_KEY`; new accounts get $50 free via code `IMPERIAL50` at
  [venice.ai/settings/api](https://venice.ai/settings/api)). `ANTHROPIC_API_KEY`, or `LLM_PROVIDER=openai`
  + `OPENAI_API_KEY`, also work.
- **Out of credits** — the provider returns a `400 … credit balance is too low`. Top up, or switch
  providers (Venice gives new accounts free credits). See [LLM.md](LLM.md).

Restart `npm run dev` after changing `.env` (the proxy reads it at startup).

---

## Settlement (`Settle`) is unavailable

The escrow round needs a funded buyer wallet and the deployed devnet program.

### `escrow IDL not found on-chain`
The client fetches the IDL from the deployed program. The default `PROGRAM_ID`
(`R5NW…CeXet`) is on **devnet** — make sure `SOLANA_RPC_URL` points at devnet. If the shared demo
deployment was removed, deploy your own from `examples/txodds/escrow` and update `PROGRAM_ID` in
`examples/txodds/agent/escrow.ts`.

### `anchor build` fails (only if you fork the contract)
Needs the Solana + Anchor toolchain (Anchor **0.32.x**). The contract is **opt-in** — the demo runs
against the already-deployed program with no build. See `examples/txodds/escrow/README.md`.

---

## Ports already in use (`:3020` / `:8801`)
Something is already bound. Find and stop it:
```sh
#   Windows:  netstat -ano | findstr :3020      macOS/Linux:  lsof -i :3020
```

---

## Still stuck?
Open an issue with: your Node version, whether the buyer wallet is funded, and the proxy log output
(`npm run dev` prints it).
