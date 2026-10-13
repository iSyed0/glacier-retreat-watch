import { massBalanceTier } from '../glacierMassBalance'

// Animated glacier glyph for DataSheet.jsx's Mass Balance tab: a melting ice cap
// whose drip count/speed scales with the glacier's estimated specific mass
// balance (m w.e./yr, from glacierMassBalance.js) -- stable/gaining
// glaciers just shimmer, heavier estimated loss drips faster and from more
// points. Pure inline SVG + CSS (see .glacier-density-icon/.gdi-* rules in
// App.css), not a pre-rendered image, so it reflects each glacier's own
// number instead of one static asset. See GLACIER_MASS_BALANCE_DENSITY.md.
const DRIP_COUNT = { unknown: 0, stable: 0, mild: 1, moderate: 2, severe: 3 }

const TIER_LABEL = {
  unknown: 'Not enough data to estimate',
  stable: 'Balanced (estimated)',
  mild: 'Mild estimated loss',
  moderate: 'Moderate estimated loss',
  severe: 'Severe estimated loss',
}

export default function GlacierDensityIcon({ specificBalanceMWe, size = 44 }) {
  const tier = massBalanceTier(specificBalanceMWe)
  const drips = DRIP_COUNT[tier]

  return (
    <div
      className={`glacier-density-icon tier-${tier}`}
      style={{ width: size, height: size }}
      title={TIER_LABEL[tier]}
    >
      <svg viewBox="0 0 56 56" width="100%" height="100%" aria-hidden="true">
        <defs>
          <linearGradient id={`gdi-ice-${tier}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eafcff" />
            <stop offset="100%" stopColor="#4dd9ff" />
          </linearGradient>
          <filter id={`gdi-glow-${tier}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path className="gdi-body" d="M28 6 L46 40 L10 40 Z" fill={`url(#gdi-ice-${tier})`} filter={`url(#gdi-glow-${tier})`} />
        <path d="M28 6 L34 20 L22 20 Z" fill="#ffffff" opacity="0.85" />
        <path className="gdi-crevasse" d="M19 32 L26 27 L31 32 L38 28" stroke="#0b2733" strokeWidth="0.7" opacity="0.22" fill="none" strokeLinecap="round" />
        <ellipse className="gdi-pool" cx="28" cy="43" rx={6 + drips * 2} ry="3" fill="#4dd9ff" opacity="0.35" />
        {Array.from({ length: drips }).map((_, i) => (
          <circle key={i} className={`gdi-drip gdi-drip-${i}`} cx={22 + i * 6} cy="40" r="1.6" fill="#4dd9ff" />
        ))}
      </svg>
    </div>
  )
}
