# AuditMesh — Architecture

Two ideas do the work: **two nested graphs of agents**, and **consent enforced on-chain**. This
document is the source material for the deck's "economy" slide.

---

## 1. The two graphs

### The market graph (the economy)

Agents meet on a CoralOS (MCP) thread and speak the starter's market protocol
(`WANT / BID / AWARD / ESCROW_REQUIRED / DEPOSITED`), plus three AuditMesh messages
(`AUTHZ_GRANT`, `AUTHZ_RESULT`, `DELIVERY_PROGRESS`).

```
                         ┌───────────────┐
                         │  audit-buyer  │  broadcasts a WANT (service=audit, scope, budget),
                         └───────┬───────┘  reasons about value, issues consent, decides to pay
              WANT ──────────────┼───────────────── WANT
        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
        │audit-discounter│ │audit-tls-spec.│  │ audit-premium │   three personas, config-only:
        │ low floor,     │ │ bids only on  │  │ widest/deepest│   cost floor, offered scope,
        │ minimal scope  │ │ config scopes │  │ coverage,     │   pricing strategy
        └───────┬───────┘  └───────┬───────┘  └──────┬────────┘
             BID │              BID │            BID │
                 └──────────────────┴────────────────┘
                         ┌───────▼───────┐
                         │  audit-buyer  │ picks best value within budget (LLM), AWARDs, and
                         └───────┬───────┘ hands the winner a signed authorization (AUTHZ_GRANT)
                                 │
                    on-chain escrow / arbiter (deployed devnet programs)
                    verifies the deal is authorized, locks funds, releases on delivery, refunds no-shows
```

The buyer's **best-value-within-budget** selection is an LLM call over the bids; the reasoning string
it produces is surfaced to the dashboard. A deterministic cheapest fallback keeps a slow model from
hanging a round. Personas differ **only** by their `coral-agent.toml` — the code is identical.

### The delivery graph (inside the winning seller)

When a seller wins and consent verifies, `deliverService()` becomes a small graph of specialist
sub-agents, delegated to [Strix](https://github.com/usestrix/strix)'s multi-agent orchestration:

```
   recon ──────────▶ analysis ──────────▶ reporting
   enumerate the     classify weaknesses   compile the structured
   authorized        within the granted    findings report (the paid
   surface           scope                  deliverable)
   └──────────────── each stage streams DELIVERY_PROGRESS to the market thread ───────────────┘
```

The stages emit `DELIVERY_PROGRESS` messages the dashboard renders as the delivery-graph view — a
graph of agents nested inside the market graph of agents.

**Report source.** `live` runs a fresh Strix scan in its Docker sandbox against the bundled target and
parses `strix_runs/<run>/` into the report schema. `prebaked` replays a **real** captured Strix report
so a filmed demo is deterministic. Both are authentic; **settlement is live on devnet regardless.**

---

## 2. The deal lifecycle (end to end)

```
buyer                              seller (winner)                     chain (devnet)
──────────────────────────────────────────────────────────────────────────────────────────
WANT (service=audit, scope, budget) ─▶ decideBid (persona) ─▶ BID
collect BIDs, pick best value ─▶ AWARD
issue signed scoped authorization ─▶ AUTHZ_GRANT ─▶ verifyAuthorization (signature +
                                                     allowlist + expiry + scope + LIVE
                                                     domain control)
                                    ◀── AUTHZ_RESULT (verified | rejected)      ── if rejected: STOP
                                    ◀── ESCROW_REQUIRED (reference = H(authzHash, round))
assert reference == H(authzHash,round)
deposit into escrow ───────────────────────────────────────────────────▶ DEPOSITED (tx)
                                    verify escrow funded ─▶ deliver:
                                       recon ─▶ analysis ─▶ reporting (DELIVERY_PROGRESS…)
                                    ◀── DELIVERED <structured report>
DECISION-TO-PAY: evaluate report ──────────────────────────────────────▶ RELEASE (tx)   ← the money moment
   (valid? on-target? bound to this deal?)                          … or no-show ─▶ REFUND after deadline
```

Every transition carries a devnet tx signature and an Explorer URL where money moved.

---

## 3. The authorization flow (the original mechanism)

Consent is two things, both required, both enforced:

### (a) Domain-control challenge — *proves control, not just a claim*

The buyer publishes a random nonce at the target, either as a DNS TXT record
(`auditmesh-authz=<nonce>`) or as `/.well-known/auditmesh-authz.txt`. For the bundled demo the nginx
**front-door** serves the well-known token, so the challenge passes genuinely end-to-end. The verifier
re-fetches it **live at request time** — a token removed after issuance fails verification, so a grant
can't be replayed after the buyer loses control.

### (b) Signed, scoped authorization — *bounds what may be done, and for how long*

The buyer signs, with its **Solana keypair** (Ed25519), a structured payload:

```jsonc
{
  "target": "http://…",           // must be on the hardcoded allowlist
  "buyerPubkey": "…",             // the signer
  "ownershipProof": { "method": "well-known", "nonce": "…", "evidence": "…" },
  "scope": { "categories": [...], "exclusions": [...], "maxDepth": 3, "nonDestructive": true },
  "issuedAt": "…", "validUntil": "…",   // time-bounded
  "nonce": "…", "correlationId": "…"
}
```

`scope` caps what the seller may do (the rules of engagement handed to Strix); `validUntil` bounds it
in time.

### (c) The verifier — *one gate, no bypass*

Used by both the seller (before any work) and the settlement path. Cheapest checks first so a bad grant
is rejected before a network round-trip:

1. **signature + content hash** (offline) — the buyer actually signed exactly this payload
2. **target ∈ allowlist** (offline) — the hard boundary; only the bundled target, ever
3. **time window** (offline) — not expired, not future-dated
4. **scope ≤ policy** (offline) — within what policy permits
5. **live domain control** (network) — the token is still published *now*

Any failure ⇒ hard stop with a machine-readable reason (surfaced as the dashboard's rejection state).
There is deliberately no "force" or "skip".

### (d) On-chain binding — *"was this authorized?" answered by the chain*

The escrow `reference` is derived as `sha256("auditmesh:" + round + ":" + authzHash)`. Both buyer and
seller derive it independently and identically; the buyer refuses to deposit unless the seller's
`ESCROW_REQUIRED` reference matches its own derivation. So the on-chain deal provably references *this
exact signed grant* — authorization isn't a checkbox in the app, it's bound into the settlement itself.

---

## 4. Module map

| Module | Responsibility |
| --- | --- |
| `@auditmesh/shared` | the contracts — report schema, authorization payloads, deal/delivery protocol messages, the **allowlist** + config (zod), structured logging (names the `decision-to-pay` event) |
| `@auditmesh/authorization` | domain-control challenge, Ed25519 signing, the verifier, the grant transport, the escrow-reference binding — **the whole consent layer, Node-only** |
| `@auditmesh/audit-service` | `runAudit()` / `deliverService()` — the delivery pipeline; the Strix subprocess wrapper (spawn, timeout, run-dir discovery); the tolerant Strix-output → report parser; the prebaked loader |
| `coral-agents/audit-buyer` | the market buyer — WANT construction, best-value selection, consent issuance, the decision-to-pay, escrow deposit/release |
| `coral-agents/audit-seller` (+ personas) | the seller image — persona bidding, consent verification, `AUTHZ_RESULT`, escrow terms, delivery with streamed progress |
| `target/` | the bundled Juice Shop + the nginx front-door that serves the `/.well-known` token |
| `examples/marketplace` | the dashboard (feed folds the messages into rounds; the React app renders the two graphs + the settlement moment) |

The starter's `@pay/agent-runtime` (LLM shim, market protocol, Solana Pay, CoralOS client) and the
deployed devnet escrow/arbiter programs are reused unchanged.

---

## 5. Failure modes, made demoable

- **No / invalid consent** → seller emits `AUTHZ_RESULT rejected`, does no work; the dashboard shows the
  red authorization badge; funds are never deposited.
- **Expired or out-of-scope grant** → verifier rejects (`EXPIRED` / `SCOPE_EXCEEDS_POLICY`).
- **Off-allowlist target** → refused at the code boundary (`TARGET_NOT_ALLOWLISTED`).
- **Seller no-show / delivery failure / Strix timeout** → no `DELIVERED`; the buyer's funds stay in
  escrow and refund after the deadline (`REFUNDED`).
- **Report fails the buyer's evaluation** → the buyer withholds release; refund path fires.

`npm run smoke` exercises the happy path plus the expired, out-of-scope, and off-allowlist rejections
in a few seconds, no infrastructure required.
