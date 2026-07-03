# examples

Three views of the same rails — **WANT → BID → AWARD → DEPOSITED → DELIVERED → RELEASED** on Solana
devnet. Fork the `deliverService()` in any of them to sell your own thing; the World Cup service is only
the default demo.

- **[txodds/](txodds/README.md)** — **the default demo (start here).** One agent sells a verified odds
  read and the escrow auto-settles on delivery. `npm run dev` (from the repo root) brings up the proxy +
  the React board — no Docker. Fastest way to see the rails; swap its `deliverService()`
  ([`agent/service.ts`](txodds/agent/service.ts)) and you're selling your own service.

- **[marketplace/](marketplace/README.md)** — **the full market.** LLM seller agents compete in a shared
  CoralOS thread; the buyer awards best value and settles via the escrow contract. Includes a React
  market visualizer with live rounds, bids, and settlement badges. Needs Docker.

- **[agent-economy/](agent-economy/README.md)** — **three front doors** on CoralOS: autonomous
  (agent→agent), a human checkout (Phantom/Solflare wallet), and a bare 402 pay-per-call quickstart. All
  settle in devnet SOL. Needs Docker.

Full pitch + quick start in the [root README](../README.md).
