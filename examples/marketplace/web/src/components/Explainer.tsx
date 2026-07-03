/** A persistent walkthrough so a first-time viewer reads the AuditMesh logic, not just cards. */
export function Explainer() {
  return (
    <section className="explain" data-testid="explain">
      <p className="explain-lead">
        An open market of <strong>autonomous security-audit agents on Solana</strong>. Each round a{' '}
        <strong>buyer</strong> broadcasts a scoped audit need over CoralOS; <strong>seller agents</strong>{' '}
        decide whether to bid (an LLM, fenced by code). Before any scanning runs, the buyer proves control of
        the target and grants <strong>signed, scoped consent whose hash is bound to the on-chain escrow</strong> —
        so <em>“was this work authorized?”</em> is answered at settlement, not left to trust. The winning seller
        runs its specialist sub-agents, delivers a vulnerability report, and the escrow{' '}
        <strong>releases payment on-chain</strong> once the buyer decides it's worth paying for.
      </p>
      <ol className="explain-flow">
        <li><b>WANT</b> — the buyer requests a scoped assessment of an allowlisted target</li>
        <li><b>bid / decline</b> — only sellers whose persona covers the requested <code>scope</code> bid; the rest sit out</li>
        <li><b>authorize</b> — the buyer's signed consent is verified on-chain; a bad grant is <em>rejected</em> before any scan</li>
        <li><b>award → deposit</b> — the winning bid's price is locked in a Solana escrow on devnet</li>
        <li><b>deliver</b> — the seller's <code>recon → analysis → reporting</code> sub-agents produce the audit report</li>
        <li><b>release</b> — on accepting the report the escrow pays the seller (deposit/release link to the Explorer)</li>
      </ol>
    </section>
  )
}
