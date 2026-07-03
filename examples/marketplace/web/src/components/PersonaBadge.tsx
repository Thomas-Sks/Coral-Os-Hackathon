import { persona as resolve, type Persona } from '../persona'

interface Props {
  /** Agent name to resolve, or a pre-resolved persona. */
  name?: string
  persona?: Persona
  /** Show the text label beside the avatar (default true). */
  label?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Optional secondary line under the label (e.g. the raw agent id in mono). */
  sub?: string
}

/**
 * An agent's visual identity: an emoji avatar in a ring tinted with the persona's accent color,
 * plus an optional label. The persona color is exposed as `--pc` so surrounding UI (winner glow,
 * pitch accents) can inherit it.
 */
export function PersonaBadge({ name, persona, label = true, size = 'md', sub }: Props) {
  const p = persona ?? resolve(name ?? '')
  return (
    <span className={`persona persona-${size}`} style={{ ['--pc' as string]: p.color }}>
      <span className="persona-avatar" role="img" aria-label={p.label}>{p.emoji}</span>
      {label && (
        <span className="persona-meta">
          <span className="persona-label">{p.label}</span>
          {sub && <span className="persona-sub mono">{sub}</span>}
        </span>
      )}
    </span>
  )
}
