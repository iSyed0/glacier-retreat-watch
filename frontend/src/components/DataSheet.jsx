import { useEffect, useState } from 'react'
import GlacierDensityIcon from './GlacierDensityIcon'
import SeverityBar from './SeverityBar'
import { computeMeasuredDensity, estimateMassBalanceDensity, formatMassRateGt, formatMassRateMaf } from '../glacierMassBalance'

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

// The flat shape TerrainView expects, built from a glacier GeoJSON feature --
// shared by the "360° Terrain View" button below and the chatbot's
// "terrain" action (chat/actions.js).
export function toTerrainFeature(feature, countryNames) {
  const p = feature.properties
  const [lon, lat] = feature.geometry.coordinates
  const density = estimateMassBalanceDensity({ rate: p.rate, area: p.area })
  return {
    lon,
    lat,
    name: p.name && p.name !== 'null' ? p.name : 'Unnamed Glacier',
    country: countryNames[p.country] || p.country,
    trend: p.trend,
    rate: p.rate,
    area: p.area,
    specificBalanceStr: density
      ? (density.specificBalanceMWe > 0 ? '+' : '') + density.specificBalanceMWe.toFixed(2) + ' m w.e./yr'
      : '—',
    massLossStr: density ? formatMassRateGt(density.massLossTPerYr) : '—',
  }
}

export default function DataSheet({ feature, countryNames, onClose, onOpenTerrainView }) {
  const open = !!feature

  // Mass Balance tab first, always -- reset on every new glacier clicked rather
  // than leaving whichever tab the previous glacier was left on.
  const [tab, setTab] = useState('density')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTab('density') }, [feature?.properties?.id])

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
      <div className="ds-badge inc"><span className="dotmini" /> Balanced</div>
    )
  } else {
    badge = (
      <div className="ds-badge stb"><span className="dotmini" /> No significant trend</div>
    )
  }

  const rate = p.rate
  const rateStr = rate === null || rate === undefined ? '—' : (rate > 0 ? '+' : '') + rate.toFixed(2) + ' m/yr'
  const areaStr = p.area !== null && p.area !== undefined ? p.area.toFixed(2) + ' km²' : '—'

  // Estimated density-based mass balance -- see glacierMassBalance.js for
  // the ice-density assumption this is built on.
  const density = estimateMassBalanceDensity({ rate, area: p.area })
  const specificBalanceStr = density
    ? (density.specificBalanceMWe > 0 ? '+' : '') + density.specificBalanceMWe.toFixed(2) + ' m w.e./yr'
    : '—'
  const massLossStr = density ? formatMassRateGt(density.massLossTPerYr) : '—'
  const massLossMafStr = density ? formatMassRateMaf(density.massLossTPerYr) : '—'

  // Real, measured density -- only computable for the rare glacier-period
  // where field mass-balance records fully cover a Hugonnet volume-change
  // period (no gaps). ~14 of 38,781 glaciers qualify; see
  // computeMeasuredDensity() and GLACIER_MASS_BALANCE_DENSITY.md.
  const allPeriods = [...(periods || []), ...(recentPeriods || [])]
  const measured = computeMeasuredDensity({ mb: massBalance, periods: allPeriods, fallbackArea: p.area })
  const latestMeasured = measured.length
    ? measured.reduce((a, b) => (b.endYear > a.endYear ? b : a))
    : null

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
      <div className="ds-tabs">
        <button className={'ds-tab' + (tab === 'density' ? ' active' : '')} onClick={() => setTab('density')}>Mass Balance</button>
        <button className={'ds-tab' + (tab === 'details' ? ' active' : '')} onClick={() => setTab('details')}>Details</button>
      </div>

      {tab === 'density' ? (
        <div className="ds-body ds-body-density">
          {badge}
          <div className="ds-density-hero">
            <GlacierDensityIcon specificBalanceMWe={density?.specificBalanceMWe ?? null} size={220} />
            <SeverityBar specificBalanceMWe={density?.specificBalanceMWe ?? null} height={200} />
          </div>

          <div className="ds-stats ds-stats-density">
            <div className="ds-stat">
              <div className="k">Mass balance (est.)</div>
              <div className={'v' + (density && density.specificBalanceMWe < 0 ? ' neg' : density && density.specificBalanceMWe > 0 ? ' pos' : '')}>{specificBalanceStr}</div>
            </div>
            <div className="ds-stat">
              <div className="k">Mass change (est.)</div>
              <div className={'v' + (density && density.massLossTPerYr < 0 ? ' neg' : density && density.massLossTPerYr > 0 ? ' pos' : '')}>{massLossStr}</div>
            </div>
            <div className="ds-stat">
              <div className="k">Mass change, water vol. (est.)</div>
              <div className={'v' + (density && density.massLossTPerYr < 0 ? ' neg' : density && density.massLossTPerYr > 0 ? ' pos' : '')}>{massLossMafStr}</div>
            </div>
          </div>

          {!density && (
            <div className="ds-empty">Not enough data (elevation-change rate or area missing) to estimate mass balance for this glacier.</div>
          )}

          {onOpenTerrainView && (
            <button
              type="button"
              className="ds-terrain-btn"
              onClick={() => onOpenTerrainView(toTerrainFeature(feature, countryNames))}
            >
              360° Terrain View
            </button>
          )}

          {latestMeasured && (
            <div className="ds-measured-density">
              <div className="ds-stat ds-stat-measured">
                <div className="k">Measured density ({latestMeasured.beginYear}–{latestMeasured.endYear})</div>
                <div className="v">{latestMeasured.densityKgM3.toFixed(0)} kg/m³</div>
              </div>
              <div className="ds-proj-note">
                Computed directly from this glacier's own field mass-balance records divided by its Hugonnet
                geodetic volume change over the same years -- a real measurement, not the 850 kg/m³ assumption
                above. Only possible because field data happens to fully cover this period; see
                GLACIER_MASS_BALANCE_DENSITY.md.
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="ds-body">
          {sortedRecentPeriods.length > 0 && (
            <div className="ds-proj-note">Trend, rate &amp; area below reflect the 2020–2026 update, not the 1999–2019 baseline.</div>
          )}

          <div className="ds-stats">
            <div className="ds-stat">
              <div className="k">Elevation change rate{sortedRecentPeriods.length > 0 ? ' (2020–26)' : ''}</div>
              <div className="v">{rateStr}</div>
            </div>
            <div className="ds-stat">
              <div className="k">Glacier area{sortedRecentPeriods.length > 0 ? ' (2026)' : ''}</div>
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
                      <td className={ab < 0 ? 'neg' : ab > 0 ? 'pos' : ''}>{ab} m w.e.</td>
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
        </div>
      )}
    </div>
  )
}
