# Autonomous — agent → agent

The **autonomous front door**: an LLM buyer agent requests a service, decides to pay, and settles
in SOL with the seller agent — no human in the loop. Both run as containers that coral-server
launches; they coordinate over CoralOS (MCP) and settle on-chain (devnet).

## Run

```sh
# prereqs: docker compose up -d coral   (from repo root) + agent images built
npm install
npm start                 # creates a session [buyer-agent, seller-agent]
```

`start.ts` creates the session — passing each agent's required options (the buyer's keypair, the
seller's wallet) from the repo-root `.env`, because coral has no default for them. coral then spawns
both agents and the buyer begins its purchase loop.

Watch it settle:

```sh
docker logs -f buyer-agent     # "paying reference=…" → "received data"
docker logs -f seller-agent    # "payment verified — delivering service"
```

Each cycle is a real devnet transaction — paste the sig into
[explorer](https://explorer.solana.com/?cluster=devnet).

## Fork points

- **What's sold:** `coral-agents/seller-agent/src/service.ts` → `deliverService()`
- **What the buyer wants / how it decides:** `coral-agents/buyer-agent/src/{goal.ts, llm_buyer.ts}`

The seller speaks the same `request` / `paid` protocol as the human [bridge](../bridge/README.md) —
this is just the agent counterparty instead of a person.
