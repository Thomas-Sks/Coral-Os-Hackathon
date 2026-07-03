import type { Round } from '../types'

const shortHash = (h: string) => (h.length > 14 ? `${h.slice(0, 12)}…` : h)

/**
 * On-chain-enforced consent state, from the AUTHZ_RESULT verdict bound to the escrow reference.
 * Three states — verified (green), rejected (red, demoable), and pending/absent (muted). Every
 * state pairs an icon + label with its color so it never reads by color alone.
 */
export function AuthzBadge({ authz }: { authz?: Round['authz'] }) {
  if (!authz) {
    return (
      <div className="authz authz-pending" data-testid="authz-badge" data-status="pending">
        <span className="authz-icon" aria-hidden>◌</span>
        <span className="authz-text">Awaiting authorization</span>
      </div>
    )
  }

  if (authz.status === 'verified') {
    return (
      <div className="authz authz-verified" data-testid="authz-badge" data-status="verified">
        <span className="authz-icon" aria-hidden>✓</span>
        <span className="authz-text">Consent verified on-chain</span>
        <span className="authz-hash mono" title={authz.hash}>{shortHash(authz.hash)}</span>
      </div>
    )
  }

  return (
    <div className="authz authz-rejected" data-testid="authz-badge" data-status="rejected">
      <span className="authz-icon" aria-hidden>⚠</span>
      <span className="authz-text">
        Authorization rejected{authz.code ? <> — <span className="authz-code mono">{authz.code}</span></> : null}
      </span>
      {authz.detail && <span className="authz-detail">{authz.detail}</span>}
    </div>
  )
}
