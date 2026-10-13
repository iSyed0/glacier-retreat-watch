import { massBalanceSeverityFraction, massBalanceTier } from '../glacierMassBalance'

const STABLE_COLOR = [94, 200, 255] // var(--blue) #5ec8ff
const SEVERE_COLOR = [255, 59, 48] // var(--red) #ff3b30

function lerpColor(t) {
  const [r1, g1, b1] = STABLE_COLOR
  const [r2, g2, b2] = SEVERE_COLOR
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `rgb(${r}, ${g}, ${b})`
}

// A vertical fill gauge next to GlacierDensityIcon, replacing the old
// "mild/moderate/severe estimated loss" text label with something that
// reads at a glance: taller + redder fill = more severe estimated loss.
// Fill height is massBalanceSeverityFraction() (0-1, see
// glacierMassBalance.js); color interpolates blue (stable) -> red
// (severe) over the same fraction, so color and height always agree.
export default function SeverityBar({ specificBalanceMWe, height = 160 }) {
  const fraction = massBalanceSeverityFraction(specificBalanceMWe)
  const tier = massBalanceTier(specificBalanceMWe)
  const fillColor = tier === 'unknown' ? 'var(--muted)' : lerpColor(fraction)
  const label = tier === 'unknown'
    ? 'Not enough data to estimate'
    : `Estimated severity: ${Math.round(fraction * 100)}%`

  return (
    <div className="severity-bar" style={{ height }} title={label} aria-label={label}>
      <div className="severity-bar-track">
        <div className="severity-bar-fill" style={{ height: `${fraction * 100}%`, background: fillColor }} />
      </div>
    </div>
  )
}
