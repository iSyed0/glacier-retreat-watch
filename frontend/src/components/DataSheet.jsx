// Mapbox GL flattens nested arrays/objects in GeoJSON properties into
// JSON strings when they pass through the vector-tile pipeline -- parse them back.
function parseMaybeJSON(v) {
  if (typeof v !== 'string') return v || null
  try {
    return JSON.parse(v)
  } catch {
    return null
  }
}

export default function DataSheet({ feature, countryNames, onClose }) {
  const open = !!feature

  if (!open) {
    return (
      <div id="datasheet">
        <div className="ds-header">
          <div>
            <div className="ds-title">—</div>
            <div className="ds-sub">—</div>
          </div>
          <button className="ds-close" onClick={onClose} title="Close">✕</button>
        </div>
        <div className="ds-body" />
      </div>
    )
  }

  const p = feature.properties
  const periods = parseMaybeJSON(p.p)
  const recentPeriods = parseMaybeJSON(p.pRecent)
  const massBalance = parseMaybeJSON(p.mb)
  const frontVariation = parseMaybeJSON(p.fv)
  const [lon, lat] = feature.geometry.coordinates
  const countryName = countryNames[p.country] || p.country
  const displayName = p.name && p.name !== 'null' ? p.name : 'Unnamed Glacier'

  let badge
  if (p.trend === -1) {
    badge = (
      <div className="ds-badge dec"><span className="dotmini" /> Retreating / Thinning</div>
    )
  } else if (p.trend === 1) {
    badge = (
      <div className="ds-badge inc"><span className="dotmini" /> Stable / Gaining</div>
    )
  } else {
    badge = (
      <div className="ds-badge stb"><span className="dotmini" /> No significant trend</div>
    )
  }

  const rate = p.rate
  const rateStr = rate === null || rate === undefined ? '—' : (rate > 0 ? '+' : '') + rate.toFixed(2) + ' m/yr'
  const areaStr = p.area !== null && p.area !== undefined ? p.area.toFixed(2) + ' km²' : '—'

  const sortedPeriods = periods && periods.length ? [...periods].sort((a, b) => a[0] - b[0]) : []
  const sortedRecentPeriods = recentPeriods && recentPeriods.length ? [...recentPeriods].sort((a, b) => a[0] - b[0]) : []
  const sortedMassBalance = massBalance && massBalance.length ? [...massBalance].sort((a, b) => a[0] - b[0]) : []
  const sortedFrontVariation = frontVariation && frontVariation.length ? [...frontVariation].sort((a, b) => a[0] - b[0]) : []

  return (
    <div id="datasheet" className="open">
      <div className="ds-header">
        <div>
          <div className="ds-title">{displayName}</div>
          <div className="ds-sub">{countryName} · {lat.toFixed(3)}°, {lon.toFixed(3)}° · Ref: {p.ref}</div>
        </div>
        <button className="ds-close" onClick={onClose} title="Close">✕</button>
      </div>
      <div className="ds-body">
        {badge}
        {sortedRecentPeriods.length > 0 && (
          <div className="ds-proj-note">Trend, rate &amp; area below reflect the 2019–2025 update, not the 1999–2019 baseline.</div>
        )}

        <div className="ds-stats">
          <div className="ds-stat">
            <div className="k">Elevation change rate{sortedRecentPeriods.length > 0 ? ' (2019–25)' : ''}</div>
            <div className="v">{rateStr}</div>
          </div>
          <div className="ds-stat">
            <div className="k">Glacier area{sortedRecentPeriods.length > 0 ? ' (2025)' : ''}</div>
            <div className="v">{areaStr}</div>
          </div>
        </div>

        <div className="ds-section-title">Elevation &amp; volume change (Hugonnet et al. 2021)</div>
        {sortedPeriods.length ? (
          <table className="ds-table">
            <thead><tr><th>Period</th><th>Elev. Δ</th><th>Vol. Δ</th></tr></thead>
            <tbody>
              {sortedPeriods.map(([b, e, ec, vc], i) => (
                <tr key={i}>
                  <td>{b}–{e}</td>
                  <td className={ec < 0 ? 'neg' : ec > 0 ? 'pos' : ''}>{ec !== null ? ec.toFixed(2) : '—'} m</td>
                  <td className={vc < 0 ? 'neg' : vc > 0 ? 'pos' : ''}>{vc !== null ? vc.toFixed(3) : '—'} Mm³</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="ds-empty">No satellite change data available.</div>
        )}

        {sortedRecentPeriods.length > 0 && (
          <>
            <div className="ds-section-title">Recent change (WGMS AMCE, Dussaillant et al. 2025)</div>
            <table className="ds-table">
              <thead><tr><th>Period</th><th>Elev. Δ</th><th>Vol. Δ</th></tr></thead>
              <tbody>
                {sortedRecentPeriods.map(([b, e, ec, vc], i) => (
                  <tr key={i}>
                    <td>{b}–{e}</td>
                    <td className={ec < 0 ? 'neg' : ec > 0 ? 'pos' : ''}>{ec !== null ? ec.toFixed(2) : '—'} m</td>
                    <td className={vc < 0 ? 'neg' : vc > 0 ? 'pos' : ''}>{vc !== null ? vc.toFixed(3) : '—'} Mm³</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {sortedMassBalance.length > 0 && (
          <>
            <div className="ds-section-title">Field mass balance</div>
            <table className="ds-table">
              <thead><tr><th>Year</th><th>Annual balance</th></tr></thead>
              <tbody>
                {sortedMassBalance.map(([y, ab], i) => (
                  <tr key={i}>
                    <td>{y}</td>
                    <td className={ab < 0 ? 'neg' : ab > 0 ? 'pos' : ''}>{ab} mm w.e.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {sortedFrontVariation.length > 0 && (
          <>
            <div className="ds-section-title">Terminus (front) variation</div>
            <table className="ds-table">
              <thead><tr><th>Period</th><th>Length change</th></tr></thead>
              <tbody>
                {sortedFrontVariation.map(([b, e, lc], i) => (
                  <tr key={i}>
                    <td>{b}–{e}</td>
                    <td className={lc < 0 ? 'neg' : lc > 0 ? 'pos' : ''}>{lc} m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="ds-footer-note">
          Source: World Glacier Monitoring Service (WGMS) Fluctuations of Glaciers Database.
          Elevation/volume change from Hugonnet et al. (2021), Nature 592, 726–731.
          {sortedRecentPeriods.length > 0 && ' 2019–25 figures are from WGMS’s Annual Mass-Change Estimates (Dussaillant et al. 2025, ESSD), which temporally downscales the same satellite elevation-change record with in-situ field measurements rather than re-measuring it directly.'}
          {' '}Glacier ID {p.id}.
        </div>
      </div>
    </div>
  )
}
