# coral-agents

Dockerized agents for the CoralOS round in [`examples/txodds/coral/`](../examples/txodds/coral).
Each agent connects to a CoralOS MCP session through `startCoralAgent` and trades in a shared market
thread.

| Agent | Role |
|---|---|
| `buyer-agent` | Broadcasts `WANT`, collects competing bids, awards best value, opens arbiter escrow, and triggers arbiter release on delivery. |
| `seller-agent` | TxODDS fulfillment image: bids on `txline`, verifies the funded escrow, and delivers the read. |
| `seller-worldcup` | Config persona reusing `seller-agent:0.1.0`; the launcher instantiates it three times as specialist/generalist/premium sellers. |

Settlement for the TxODDS round is arbiter-gated by default: the buyer funds a vault PDA, the seller
verifies that vault-backed escrow, and the neutral arbiter key releases payment after delivery.

## Build

```sh
bash build-agents.sh
```

The round launcher creates one buyer and three seller instances. `seller-fast` and `seller-premium`
reuse the local `seller-worldcup` package id but run with different `AGENT_NAME`, `PERSONA`, and
`FLOOR_SOL` options.
