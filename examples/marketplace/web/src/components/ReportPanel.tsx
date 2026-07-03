import { SEVERITIES, severityRank, type AuditReport, type Finding, type Severity } from '@auditmesh/shared'

const SEV_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
}

/** Severities worst-first, for both the summary chips and (as a safety net) the findings sort. */
const SEV_DESC: Severity[] = [...SEVERITIES].reverse()

/**
 * Renders the delivered AuditReport as the paid artifact — a headline, severity counts, and a card
 * per finding with a labelled severity tag, affected component, CVSS, redacted evidence, and the fix.
 */
export function ReportPanel({ report }: { report: AuditReport }) {
  const findings = [...report.findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  const counts = report.summary.bySeverity
  const chips = SEV_DESC.filter((s) => (counts[s] ?? 0) > 0)

  return (
    <section className="report" data-testid="report-panel" aria-label="delivered audit report">
      <header className="report-head">
        <div className="report-titlerow">
          <span className="report-kicker">Audit report</span>
          <code className="report-target mono">{report.target}</code>
        </div>
        <p className="report-headline">{report.summary.headline}</p>
        <div className="report-counts">
          {chips.length === 0 ? (
            <span className="sev-chip sev-info"><span className="sev-dot" aria-hidden />No issues in scope</span>
          ) : (
            chips.map((s) => (
              <span key={s} className={`sev-chip sev-${s}`}>
                <span className="sev-dot" aria-hidden />
                <span className="sev-count mono">{counts[s]}</span> {SEV_LABEL[s]}
              </span>
            ))
          )}
        </div>
      </header>

      <ol className="report-findings">
        {findings.map((f) => <FindingRow key={f.id} f={f} />)}
      </ol>

      <footer className="report-foot">
        {report.provenance.engine} · {report.provenance.scanMode} scan · {report.provenance.source}
        {report.findings.length > 0 && <> · {report.findings.length} finding{report.findings.length === 1 ? '' : 's'}</>}
      </footer>
    </section>
  )
}

function FindingRow({ f }: { f: Finding }) {
  return (
    <li className="finding" data-testid="finding" data-severity={f.severity}>
      <div className="finding-head">
        <span className={`sev-tag sev-${f.severity}`}>
          <span className="sev-dot" aria-hidden />{SEV_LABEL[f.severity]}
        </span>
        <span className="finding-title">{f.title}</span>
        {f.cvss && <span className="finding-cvss mono" title={f.cvss.vector}>CVSS {f.cvss.baseScore.toFixed(1)}</span>}
      </div>
      <div className="finding-meta">
        <code className="finding-component mono">{f.affectedComponent}</code>
        {f.cwe && <span className="finding-cwe mono">{f.cwe}</span>}
        <span className="finding-id mono">{f.id}</span>
      </div>
      {f.evidence && <pre className="finding-evidence mono">{f.evidence}</pre>}
      <p className="finding-fix"><strong>Fix</strong> {f.remediation}</p>
    </li>
  )
}
