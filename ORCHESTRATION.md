# AuditMesh — agent orchestration flow

A buyer-agent procures a real pentest from competing seller-agents, proves consent on-chain, and — on a
report it judges worth paying for — releases escrow on Solana devnet. Two graphs, one settlement.

```
ACTORS
  BUYER        seller-agent that wants an audit — reasons on value, enforces consent, decides to pay
  SELLERS ×3   discounter (quick) · specialist (standard) · premium (deep) — bid on their own cost
  BROKER       host-side; runs Strix for the winner (the container can't run Docker-in-Docker)
  STRIX        the delivery sub-agents: recon → analysis → reporting
  ESCROW       Solana devnet escrow / arbiter — locks and releases the funds
  TARGET       bundled Juice Shop + /.well-known consent token


01 · NEGOTIATE  ── market graph ──────────────────────────────────────────────
      BUYER ──WANT(service=audit, scope, budget, surface=pages/forms/endpoints)──▶ SELLERS ×3
      BUYER ◀──────────────── BID(price)  (each prices its own Strix token cost) ── SELLERS ×3
      BUYER ──AWARD(best value)──────────────────────────────────────────────────▶ WINNER

02 · CONSENT  ── enforced on-chain ──────────────────────────────────────────
      BUYER  ──AUTHZ_GRANT(signed, scoped, buyer key)──▶ WINNER
      WINNER ──verify /.well-known/auditmesh-authz.txt──▶ TARGET   (live domain control + in-scope)
      BUYER  ◀──AUTHZ_RESULT(ok, hash)──────────────────  WINNER   (no valid grant ⇒ no work)

03 · ESCROW  ── lock the funds ─────────────────────────────────────────  ⛓ devnet
      WINNER ──ESCROW_REQUIRED(reference, seller wallet)──▶ BUYER
      BUYER  ──deposit → escrow PDA (bound to the authz hash)──▶ ⛓
      BUYER  ──DEPOSITED(tx sig)──────────────────────────────▶ WINNER

04 · DELIVER  ── delivery graph, inside the winner ──────────────────────────
      WINNER ──scan(granted scope, persona depth)──▶ BROKER ──▶ STRIX
                                                                  recon → analysis → reporting ⇒ findings
      BUYER  ◀──DELIVERED(signed report: severity · CVSS · evidence · fix)── WINNER

05 · SETTLE  ── the money moment ★ ─────────────────────────────────────  ⛓ devnet
      BUYER: evaluate report ─▶ DECISION-TO-PAY
      BUYER ──RELEASE escrow → seller paid──▶ ⛓   (RELEASED tx sig)
      fallback: invalid report / no-show ─▶ refund after the deadline


  WANT → BID → AWARD → AUTHZ → [DEPOSITED] → DELIVERED → [RELEASED]      end-to-end on Solana devnet
                                    ⛓                          ⛓        (each ⛓ = a real, clickable tx)
```

**Lead with the settlement.** The story is `DECISION-TO-PAY → RELEASED`: an agent reads a report, judges
it worth paying for, and pays another agent on-chain. The escrow, PDAs and MCP transport are plumbing —
assumed to work, not the pitch.
