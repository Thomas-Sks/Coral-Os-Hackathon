# AuditMesh — an autonomous agent-to-agent security marketplace

> **Buyer agents hire seller agents to pentest a website, and pay them on-chain — but only after
> proving they're allowed to.** A buyer broadcasts a job; competing seller personas bid at machine
> speed; the winner runs a real security assessment and returns a structured vulnerability report; a
> **Solana devnet escrow** locks the funds on award and releases them the instant the buyer decides
> the report is worth paying for. The twist that makes an agent security market *credible instead of
> dangerous*: **consent is enforced on-chain** — no scan runs and no escrow releases without a signed,
> scoped, live-verified authorization for the target.

**The money moment is the point the story leads with: the instant the buyer agent decides to pay and
the escrow releases on-chain.** The pentest is the *reason* payment is justified; the autonomous,
consent-gated settlement is the *story*.

Built on the [CoralOS × Solana starter kit](https://github.com/trilltino/solana_coralOS) — the market
protocol, LLM shim, Solana Pay, and the deployed devnet escrow are reused as-is; AuditMesh forks the
`deliverService()`, adds the seller personas, the on-chain authorization layer, the Strix integration,
and the dashboard.

**🔗 Proof it settles on devnet** — one release from a past run, confirmed & finalized:
[`explorer.solana.com/tx/3pdj4Gto…cKBK7GRr`](https://explorer.solana.com/tx/3pdj4GtozAWUx836SvF7waSk8Ua8swJLcAMyCiQumY56JHNy53kmtYRBgsNiuDYHmFa2LUMAMQVe3j37cKBK7GRr?cluster=devnet).
It's an *example* — **every run mints its own**: when you run the demo, your release link appears live on
the page — in the header's **session Explorer bar** and on each round's settlement card (both clickable) —
and in the feed. This one just proves the rails are real.

---

## The two graphs (the core narrative)

- **The market graph (economy).** A buyer agent and three competing seller personas whose offers map to
  a **real, differentiated deliverable** (not just a price tag) — the winning persona sets the scan depth:
  - `audit-discounter` — cheap, fast **`quick`** pass over headers + TLS only.
  - `audit-tls-specialist` — a **`standard`**-depth expert TLS/headers review; only bids on config jobs.
  - `audit-premium` — the **`deep`**est scan available, of the **full scope the buyer authorizes**; takes the
    broadest jobs the others decline. Priciest.

  The buyer requests a scope + budget; whoever wins runs Strix **scoped to exactly what was granted, at its own
  depth**. The scope is bounded by the buyer's on-chain authorization — a seller assesses that scope and no
  more (even premium; it can't scan families the buyer didn't ask for). So personas differ by **depth** and
  which scopes they'll take, not by scanning beyond consent. An on-chain escrow/arbiter verifies the
  authorization and settles the deal.
- **The delivery graph (inside one seller).** Once awarded, the winning seller delegates to a graph of
  specialist sub-agents — **recon → analysis → reporting** — powered by [Strix](https://github.com/usestrix/strix)'s
  multi-agent orchestration, run against the embedded target.

A graph of agents nested inside a graph of agents. Every new agent turns a pair into a graph.

```
MARKET GRAPH                                        DELIVERY GRAPH (inside the winning seller)
                                                    ┌───────────────────────────────────────┐
  buyer ──WANT──▶ discounter  tls-specialist  premium│  recon ─▶ analysis ─▶ reporting         │
    ▲               │  BID        │  BID       │  BID │    (Strix, against the bundled target)  │
    │  best value   └─────────────┴────────────┘     └───────────────────────────────────────┘
    └── AWARD ─▶ AUTHZ_GRANT ─▶ [seller verifies consent] ─▶ ESCROW_REQUIRED ─▶ DEPOSITED
                                                          ─▶ DELIVERED <report> ─▶ DECISION-TO-PAY ─▶ RELEASED
```

---

## Run it — the single judge command

### Prerequisites (one-time)

| Need | How |
| --- | --- |
| **Node 20+** | [nodejs.org](https://nodejs.org) |
| **Python 3.12+** | For the Strix engine (`npm run demo` installs `strix-agent` into a venv). [python.org](https://www.python.org/downloads/) |
| **Docker**, with your user in the `docker` group | `sudo usermod -aG docker $USER` then **re-login** (so `docker ps` works without sudo). ~10 GB free disk (Strix's sandbox image is ~3 GB). |
| **A funded devnet buyer wallet** | `npm run setup` generates the wallets into `.env`; then fund the **buyer** at [faucet.solana.com](https://faucet.solana.com) (GitHub sign-in) — ~0.1 SOL covers many rounds. |
| **An LLM key** (the agents reason with it) | Add to `.env`: `LLM_PROVIDER=deepseek` + `DEEPSEEK_API_KEY=…` (recommended — cheap, OpenAI-compatible). Anthropic / OpenAI / Venice also work (`LLM_PROVIDER=` + the matching key). |

### Then, one command:

```sh
npm run demo
```

That's it — `npm run demo` is **fully self-bootstrapping and runs a real Strix scan**. On a fresh clone it:
1. **installs every dependency + builds the workspace packages** (all `npm install`s + the package dist),
2. **installs Strix — mandatory** — the engine (`pip install strix-agent`) + its ~3 GB sandbox image,
3. publishes a fresh domain-control token + sets coral's host address for your OS (Linux `172.17.0.1` · Docker Desktop `host.docker.internal`),
4. brings up the bundled target, then **runs a REAL Strix pentest against it (~5–15 min)** — that scan *is* the report the market delivers,
5. builds the agent images (baking in the fresh report; first run also pulls coral / Juice Shop / nginx),
6. brings up coral, clean-slates it, launches **exactly one** market session (buyer + 3 seller personas),
7. starts the dashboard.

> **Strix is mandatory.** Every `npm run demo` installs it and runs a genuine pentest against the target
> — it prints **`⏳ STRIX SCAN IN PROGRESS`** and **waits** for the scan to finish (~5–15 min) before the
> market starts; that fresh scan *is* the report the market delivers. The first run also downloads the
> ~3 GB sandbox image, so it takes longest. **Settlement is live on devnet.**

**→ Open [http://localhost:5173](http://localhost:5173)** and watch a new negotiation run about every 30s.
When the buyer decides to pay, the buyer container logs a clickable devnet **Explorer** link for the
release (`docker logs -f <buyer-container> | grep -i explorer`).

Stop everything with:

```sh
docker compose -f docker-compose.auditmesh.yml down   # (or docker-compose … on legacy Docker)
```

### A verified end-to-end run (WANT → … → RELEASED)

This exact loop has run on devnet. From one real round's logs:

```
WANT round=1 service=audit arg=tls+hdr budget=0.02
BID  audit-discounter 0.004 · audit-tls-specialist 0.012 · audit-premium 0.015   ← the sellers pitch
AWARD → audit-premium  "…full depth and a clean history, beating tls-specialist's limited value and discounter's shallow pass"
AUTHZ_RESULT verified          ← the seller checked the buyer's signed, live-domain-verified consent
ESCROW_REQUIRED (reference bound to the authorization hash)
DEPOSITED  → escrow funded on devnet
DELIVERED  <8-finding Strix report: 2 critical SQLi, password-hash leak, IDOR, …>
DECISION-TO-PAY → PAY
RELEASED   sig=3pdj4Gto…cKBK7GRr   → https://explorer.solana.com/tx/3pdj4Gto…?cluster=devnet   (confirmed)
```

### Troubleshooting

- **`cannot talk to Docker`** → your shell isn't in the `docker` group yet. Re-login after `usermod -aG docker $USER`, or start a new terminal.
- **Only one seller bids / "only bidder"** → you have more than one session running (coral respawns killed agents). `npm run demo` prevents this by restarting coral, but if you launched sessions by hand, `docker restart coral` for a clean slate and launch just one.
- **Agents exit immediately** → coral can't be reached at its `[docker].address`. `npm run demo` sets this per-OS; if you run coral by hand on Docker Desktop, set `address = "host.docker.internal"` in `examples/txodds/coral/coral.toml`.
- **Devnet airdrop fails (429 / internal error)** → the public RPC gates airdrops; use the web faucet.

### No Docker? Run the flow off-chain in seconds

```sh
npm run packages         # build the workspace packages (once)
npm run smoke            # the whole flow — consent → deliver → decision-to-pay — with no Docker/devnet
```

`npm run smoke` exercises the exact library logic the agents run, plus the three rejection paths
(expired grant, out-of-scope grant, off-allowlist target). It's the fastest way to see AuditMesh work.

### Strix — the real scan (mandatory)

**Every `npm run demo` runs a genuine Strix pentest.** Strix runs its scan inside its own Docker
sandbox, and the seller runs inside a coral-spawned container (no Docker-in-Docker there), so the scan
runs **once on the host at startup**; its real output is baked into the seller image and delivered by
the market. So the report is always a fresh, real Strix scan — while the market itself stays fast to
watch. The demo installs Strix for you (engine + the ~3 GB sandbox image, first run only).

To drive Strix by hand — or to re-scan without launching the whole market:

```sh
npm run setup:strix   # install the engine (pip install strix-agent) + pull the sandbox image (once)
npm run scan:live     # run a fresh scan against the running target → reports/live-report.json
```

> **Why isn't the ~3 GB Strix image committed to the repo?** GitHub rejects files over 100 MB and Git
> LFS is impractical/expensive at that size, so shipping it in git isn't viable. `setup:strix` downloads
> it instead — the judge gets the identical complete setup without a bloated repo. The download is
> **resumable**: if a plain `docker pull` stalls on a flaky network, it falls back to a resume-on-drop
> downloader, so it always completes.

Strix and the agents share the same LLM key (`DEEPSEEK_API_KEY` / `STRIX_LLM`). **Settlement is live on
devnet regardless.**

---

## What's on screen (the dashboard)

A light, premium "web3 product" dashboard (`http://localhost:5173`). The centerpiece is the
**Market Floor** — you watch the agents debate:

1. **The negotiation** — the buyer posts its ask (scope + budget); the three sellers answer with
   **pitch cards** (persona avatar + price + their argument), competing on price and coverage; then the
   buyer's **verdict** lights up the winner with a ★ badge and its reasoning quote — explicitly weighing
   the winner against the rivals it passed on (you watch the buyer *think*).
2. **Deal pipeline** — `WANT → BID → AWARD → AUTHORIZED → DEPOSITED → DELIVERED → RELEASED`; nodes light
   up on transition, on-chain nodes link to the Explorer.
3. **Delivery graph** — the seller's recon → analysis → reporting sub-agents activating in sequence.
4. **The settlement moment** — a dedicated, emphasized beat when the buyer decides to pay: the release
   animates and the **Explorer link surfaces large and clickable**.
5. **Report panel** — the structured findings (colored severity, CVSS, evidence, remediation) rendered
   as something worth paying for — not raw JSON.
6. **Authorization badge** — an on-chain-verified-consent indicator, including the **rejection state**.
7. **The agents panel** — a legend (top of the page) naming who's competing and what each actually
   delivers (buyer + the three seller personas, with their scan depth).

**On-chain proof, always in reach.** The header carries a **session-level Explorer bar**: a direct link to
the **latest settlement transaction** and to the buyer wallet's devnet address (whose Explorer page lists
**every deposit/release this session made**). So the session's settlement is one click away on the page —
not buried in a round card — in addition to the per-round deposit/release links in the deal pipeline.

---

## Safety model (non-negotiable, enforced in code)

AuditMesh is built to be a *credible* security market, not a dangerous one:

- **The target is the bundled, self-hosted, deliberately-vulnerable Juice Shop only.** A **hardcoded
  allowlist** ([`packages/shared/src/config.ts`](packages/shared/src/config.ts)) is checked at the code
  boundary in both the authorization verifier and `deliverService()`. There is **no mode** that points
  the scanner at an arbitrary external URL. (`npm run smoke` proves an off-allowlist target is refused.)
- **Consent is a real, enforced gate.** The buyer must (1) prove control of the target — a nonce it
  publishes at `/.well-known/auditmesh-authz.txt`, re-fetched **live** at scan time — and (2) sign a
  **scoped, time-bounded** authorization with its Solana keypair. The verifier checks signature +
  allowlist + expiry + scope + live domain control; any failure is a hard stop. The escrow `reference`
  is derived from the authorization hash, so *"was this authorized?"* is answered on-chain at settlement.
- **The offensive capability is delegated.** The actual assessment runs the existing open-source
  **[Strix](https://github.com/usestrix/strix)** as a sandboxed subprocess. AuditMesh's code is the
  marketplace, orchestration, authorization, and reporting layer — **it authors no exploit code**.
- **No secrets in the repo.** All keys live in a gitignored `.env`; a `.env.example` ships placeholders.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the two graphs and the authorization flow in detail.

---

## Repo layout (what AuditMesh adds)

| Path | Purpose |
| --- | --- |
| [`packages/shared/`](packages/shared) | contracts — report schema, authorization payloads, deal protocol, the target **allowlist**, config (zod-validated), structured logging |
| [`packages/authorization/`](packages/authorization) | the consent layer — domain-control challenge, Solana-keypair signing, the verifier, the escrow-reference binding |
| [`packages/audit-service/`](packages/audit-service) | the sold artifact — `deliverService()` + the Strix subprocess wrapper + the tolerant report parser |
| [`coral-agents/audit-buyer/`](coral-agents/audit-buyer) | the buyer — value reasoning, consent issuance, the **decision-to-pay** |
| [`coral-agents/audit-seller/`](coral-agents/audit-seller) | the seller image — persona bidding, consent verification, delivery |
| `coral-agents/audit-{discounter,tls-specialist,premium}/` | the three competing personas (config only) |
| [`target/`](target) | the bundled Juice Shop + nginx front-door that serves the `/.well-known` token |
| [`reports/prebaked-juice-shop.json`](reports/prebaked-juice-shop.json) | a real captured Strix report for `prebaked` mode |
| [`examples/marketplace/`](examples/marketplace) | the dashboard (feed + web) + the session launcher `start-audit.ts` |
| `docker-compose.auditmesh.yml`, `scripts/demo.mjs`, `build-audit-agents.sh` | the one-command demo harness |

Everything under the starter's original layout (the TxODDS oracle, `packages/agent-runtime`, the escrow
programs) is reused unchanged; see [README.starter.md](README.starter.md) and [CLAUDE.md](CLAUDE.md).

---

## Devnet funding

The buyer wallet signs the escrow deposit/release and the authorization, so it needs a little devnet
SOL. `npm run setup` generates the wallets into `.env` (and `WALLETS.txt`); fund the **buyer** at
[faucet.solana.com](https://faucet.solana.com) (GitHub sign-in — the only reliable devnet faucet). The
seller and arbiter only receive / co-sign, so they need no (or negligible) funding. Devnet only — never
put a funded mainnet key in `.env` (the runtime's `solanaConnection()` guard throws on a mainnet RPC).

---

## Configuration

All tunables live in `.env` (see [.env.example](.env.example)) and are validated with zod. The important
AuditMesh ones: `AUDIT_TARGET` (must be allowlisted), `REPORT_SOURCE` (`prebaked` | `live`), `SCAN_MODE`,
`STRIX_LLM` + `LLM_API_KEY` (live Strix), `BUYER_MAX_SOL` (budget ceiling), `AUDIT_SCOPES` (rotated
per-round requested scopes), `SETTLEMENT_MODE` (`arbiter` | `direct`), `DELIVERY_PACING_MS`.

---

## Tests

```sh
npm run smoke                                   # end-to-end flow (prebaked) + all rejection paths
npm --prefix packages/shared test               # report schema, protocol, config/allowlist, scope
npm --prefix packages/authorization test        # verifier: valid / expired / wrong-target / out-of-scope, signing, challenge
npm --prefix packages/audit-service test        # report parser, delivery pipeline, fork-point wrapper
npm --prefix coral-agents/audit-seller test     # persona bid evaluation
npm --prefix examples/marketplace/feed test     # dashboard fold of AUTHZ_RESULT + DELIVERY_PROGRESS
```

## License

MIT (as the starter).
