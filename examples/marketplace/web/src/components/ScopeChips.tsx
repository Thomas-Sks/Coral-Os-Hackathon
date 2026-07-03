import { scopeCodes } from '../format'

/** Render a WANT `arg` (`hdr+tls+xss`) as friendly scope chips; non-scope args show as one chip. */
export function ScopeChips({ arg }: { arg?: string }) {
  const codes = scopeCodes(arg)
  if (codes.length === 0) return null
  return (
    <span className="scope-chips">
      {codes.map(({ code, label }) => (
        <span className="scope-chip" key={code} title={code}>{label}</span>
      ))}
    </span>
  )
}
