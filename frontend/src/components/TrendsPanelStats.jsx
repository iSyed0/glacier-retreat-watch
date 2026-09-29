import { useEffect, useMemo, useRef, useState } from 'react'

// Colors validated (node scripts/validate_palette.js) against this app's
// dark panel background. Reused for both the HKH-wide and Pakistan-scoped
// instances of this panel (see App.jsx) -- same series, same identity,
// just a different `data` prop and title/sub/scopeNote text.
const GLACIER_COLOR = '#3987e5'
const TEMP_COLOR = '#d95926'

const CHART_W = 520
const CHART_H = 108
const PAD_L = 46
const PAD_R = 16
const PAD_TOP = 14
const PAD_BOTTOM = 10
const CHART_MAX_H = 420

function periodLabel(p) {
  return `${p.startYear}–${p.endYear}`
}

function xScale(i, n) {
  const usable = CHART_W - PAD_L - PAD_R
  return n <= 1 ? PAD_L : PAD_L + (usable * i) / (n - 1)
}

function yScale(value, min, max) {
  const usable = CHART_H - PAD_TOP - PAD_BOTTOM
  if (max === min) return PAD_TOP + usable / 2
  return PAD_TOP + usable * (1 - (value - min) / (max - min))
}

function StatIcon({ name }) {
  const common = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round', width: 14, height: 14 }
  if (name === 'elevation') return <svg {...common}><path d="M3 19h18L14 7l-3 4-3-3-5 11z" /></svg>
  if (name === 'mass') return <svg {...common}><path d="M12 3v11" /><polyline points="8 10 12 14 16 10" /><rect x="4" y="17" width="16" height="4" rx="1" /></svg>
  if (name === 'temperature') return <svg {...common}><path d="M12 14.5V4a2 2 0 0 0-4 0v10.5a4 4 0 1 0 4 0z" /></svg>
  if (name === 'area') return <svg {...common}><polygon points="12 4 3 9 12 14 21 9 12 4" /><polyline points="3 14 12 19 21 14" /></svg>
  return (
    <svg {...common}>
      <rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function StatCard({ icon, color, label, value, unit, sub }) {
  return (
    <div className="tplus-stat-card" style={{ '--stat-color': color }}>
      <div className="tplus-stat-head"><StatIcon name={icon} /><span className="tplus-stat-label">{label}</span></div>
      <div className="tplus-stat-value">{value}{unit && <span className="tplus-stat-unit">{unit}</span>}</div>
      {sub && <div className="tplus-stat-sub">{sub}</div>}
    </div>
  )
}

function LineChart({ title, unit, values, color, formatValue, activeIndex }) {
  const nums = values.filter((v) => v != null)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const pad = (max - min) * 0.25 || Math.abs(max) * 0.1 || 1
  const yMin = min - pad
  const yMax = max + pad

  const points = values.map((v, i) => (v == null ? null : [xScale(i, values.length), yScale(v, yMin, yMax)]))
  const linePath = points
    .map((p, i) => (p ? `${i === 0 || !points[i - 1] ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}` : ''))
    .join(' ')
    .trim()

  const firstIdx = points.findIndex((p) => p)
  const lastIdx = points.length - 1 - [...points].reverse().findIndex((p) => p)

  return (
    <g>
      <text x={PAD_L} y={PAD_TOP - 4} className="tplus-chart-title">{title}</text>
      {points.map((p, i) => p && (
        <line
          key={`grid-${i}`}
          x1={p[0]} x2={p[0]}
          y1={PAD_TOP} y2={CHART_H - PAD_BOTTOM}
          className="tplus-gridline"
        />
      ))}
      {linePath && (
        <path
          d={linePath}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter="url(#tplusGlow)"
        />
      )}
      {points.map((p, i) => p && (
        <circle
          key={i}
          cx={p[0]} cy={p[1]}
          r={i === activeIndex ? 5 : 4}
          fill={color}
          stroke="var(--bar-bg)"
          strokeWidth="2"
        />
      ))}
      {firstIdx >= 0 && (
        <text x={points[firstIdx][0]} y={points[firstIdx][1] - 10} textAnchor="start" className="tplus-value-label">
          {formatValue(values[firstIdx])}{unit}
        </text>
      )}
      {lastIdx !== firstIdx && lastIdx >= 0 && (
        <text x={points[lastIdx][0]} y={points[lastIdx][1] - 10} textAnchor="end" className="tplus-value-label">
          {formatValue(values[lastIdx])}{unit}
        </text>
      )}
    </g>
  )
}

const TOOLTIP_W = 230
const TOOLTIP_H = 104
const TOOLTIP_OFFSET = 16

function clampTooltipPos(clientX, clientY) {
  let left = clientX + TOOLTIP_OFFSET
  let top = clientY + TOOLTIP_OFFSET
  if (left + TOOLTIP_W > window.innerWidth) left = clientX - TOOLTIP_W - TOOLTIP_OFFSET
  if (top + TOOLTIP_H > window.innerHeight) top = clientY - TOOLTIP_H - TOOLTIP_OFFSET
  return { left: Math.max(4, left), top: Math.max(4, top) }
}

// The two things this panel can plot as the "glacier" series, against the
// same temperature series -- everything that differs between them (which
// field to read, chart/table/card text, units, footnote methodology) lives
// here so the rest of the component stays variant-agnostic.
const METRICS = {
  elevation: {
    rateKey: 'elevationChangeRateM',
    icon: 'elevation',
    chartTitle: 'Elevation change rate (m/yr)',
    cardLabel: 'Elevation change',
    cardUnit: ' m',
    cardDecimals: 2,
    tableHeader: 'Elev. Δ (m/yr)',
    tableDecimals: 3,
    tooltipLabel: 'Elevation Δ',
    tooltipUnit: ' m/yr',
    methodNote: (scopeNote) =>
      `Elevation change: area-weighted mean across ${scopeNote} with a figure for that period (Hugonnet et al. 2021), the actual resolution the satellite record supports -- not truly annual.`,
  },
  mass: {
    rateKey: 'massBalanceRateGtYr',
    icon: 'mass',
    chartTitle: 'Mass balance rate (Gt/yr)',
    cardLabel: 'Mass change',
    cardUnit: ' Gt',
    cardDecimals: 2,
    tableHeader: 'Mass Δ (Gt/yr)',
    tableDecimals: 2,
    tooltipLabel: 'Mass balance',
    tooltipUnit: ' Gt/yr',
    methodNote: (scopeNote) =>
      `Mass balance: total ice-volume change across ${scopeNote} (Hugonnet et al. 2021), converted to mass with a standard ice density of 850 kg/m³ (Huss, 2013) -- the same satellite-record resolution/caveats as elevation change apply.`,
  },
}

export default function TrendsPanelStats({
  open,
  onClose,
  data,
  status,
  error,
  title = 'Glacier change vs. temperature',
  sub = 'HKH region · 1999–2019 measured, 2019–2025 WGMS AMCE update',
  scopeNote = 'every HKH glacier',
  variant = 'elevation',
}) {
  const metric = METRICS[variant]
  const [activeIndex, setActiveIndex] = useState(null)
  const [tooltipPos, setTooltipPos] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const modalRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [pos, setPos] = useState(null)
  const [dragging, setDragging] = useState(false)

  const clampPos = (left, top) => {
    const modal = modalRef.current
    const margin = 24
    if (!modal) return { left, top }
    const { width, height } = modal.getBoundingClientRect()
    return {
      left: Math.min(Math.max(left, -width + margin), window.innerWidth - margin),
      top: Math.min(Math.max(top, 0), window.innerHeight - margin),
    }
  }

  const handleHeaderPointerDown = (e) => {
    if (isFullscreen) return
    const modal = modalRef.current
    if (!modal) return
    const rect = modal.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setPos({ left: rect.left, top: rect.top })
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handleHeaderPointerMove = (e) => {
    if (!dragging) return
    setPos(clampPos(e.clientX - dragOffset.current.x, e.clientY - dragOffset.current.y))
  }

  const handleHeaderPointerUp = (e) => {
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const toggleFullscreen = () => {
    setIsFullscreen((f) => !f)
    setPos(null)
  }

  const modalStyle = pos && !isFullscreen ? { position: 'fixed', left: pos.left, top: pos.top, margin: 0 } : undefined

  const periods = data || []
  const n = periods.length

  // Headline numbers for the stat cards -- derived from the same real
  // per-period data as the charts/table below, not separately sourced.
  const stats = useMemo(() => {
    if (!n) return null
    const first = periods[0]
    const last = periods[n - 1]
    const cumulativePrimary = periods.reduce(
      (sum, p) => (p[metric.rateKey] != null ? sum + p[metric.rateKey] * (p.endYear - p.startYear) : sum),
      0
    )
    const tempDeltaC = first.meanTempC != null && last.meanTempC != null ? last.meanTempC - first.meanTempC : null
    return {
      spanLabel: `${first.startYear}–${last.endYear}`,
      baselineLabel: `${first.startYear}–${first.endYear}`,
      cumulativePrimary,
      tempDeltaC,
      baselineAreaKm2: first.totalAreaKm2,
      baselineCount: first.glacierCount,
      hasRecentPeriod: last.startYear === 2019 && last.endYear === 2025,
    }
  }, [periods, n, metric.rateKey])

  const handleMove = (e) => {
    if (!n) return
    const svg = e.currentTarget
    const rect = svg.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * CHART_W
    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xScale(i, n) - px)
      if (d < nearestDist) { nearestDist = d; nearest = i }
    }
    setActiveIndex(nearest)
    setTooltipPos(clampTooltipPos(e.clientX, e.clientY))
  }

  const active = activeIndex != null ? periods[activeIndex] : null

  const svgHeight = CHART_H * 2 + 34
  const chartRatio = CHART_W / svgHeight

  const chartWrapRef = useRef(null)
  const [chartSize, setChartSize] = useState({ width: CHART_W, height: svgHeight })

  useEffect(() => {
    const el = chartWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const containerWidth = el.clientWidth
      if (!containerWidth) return
      const maxH = isFullscreen && el.clientHeight > 0 ? el.clientHeight : CHART_MAX_H
      let width = containerWidth
      let height = width / chartRatio
      if (height > maxH) {
        height = maxH
        width = height * chartRatio
      }
      setChartSize({ width, height })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [chartRatio, isFullscreen])

  const xTicks = useMemo(() => periods.map((p, i) => ({ x: xScale(i, n), label: periodLabel(p) })), [periods, n])

  if (!open) return null

  return (
    <div className="tplus-overlay" onClick={onClose}>
      <div
        className={`tplus-modal${isFullscreen ? ' fullscreen' : ''}`}
        ref={modalRef}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="tplus-header"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          title={isFullscreen ? undefined : 'Drag to move'}
        >
          <div>
            <div className="tplus-title">{title}</div>
            <div className="tplus-sub">{sub}</div>
          </div>
          <div className="tplus-header-actions">
            <button
              className="ds-close"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {isFullscreen ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 3 9 9 3 9" />
                  <polyline points="15 3 15 9 21 9" />
                  <polyline points="9 21 9 15 3 15" />
                  <polyline points="15 21 15 15 21 15" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 9 3 3 9 3" />
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="21 15 21 21 15 21" />
                  <polyline points="9 21 3 21 3 15" />
                </svg>
              )}
            </button>
            <button
              className="ds-close"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              title="Close"
            >✕</button>
          </div>
        </div>

        <div className="tplus-body">
          {status === 'loading' && <div className="ds-empty">Loading…</div>}
          {status === 'error' && <div className="era5-error">Trend data unavailable{error ? ` — ${error}` : ''}</div>}

          {status === 'ready' && n > 0 && (
            <>
              {stats && (
                <div className="tplus-stats">
                  <StatCard
                    icon={metric.icon}
                    color={GLACIER_COLOR}
                    label={metric.cardLabel}
                    value={`${stats.cumulativePrimary >= 0 ? '+' : ''}${stats.cumulativePrimary.toFixed(metric.cardDecimals)}`}
                    unit={metric.cardUnit}
                    sub={`${stats.spanLabel} cumulative`}
                  />
                  <StatCard
                    icon="temperature"
                    color={TEMP_COLOR}
                    label="Temperature change"
                    value={stats.tempDeltaC != null ? `${stats.tempDeltaC >= 0 ? '+' : ''}${stats.tempDeltaC.toFixed(2)}` : '—'}
                    unit="°C"
                    sub={`${stats.spanLabel} change`}
                  />
                  <StatCard
                    icon="area"
                    color="var(--accent)"
                    label="Glacier area sampled"
                    value={stats.baselineAreaKm2 != null ? Math.round(stats.baselineAreaKm2).toLocaleString() : '—'}
                    unit=" km²"
                    sub={`${stats.baselineLabel} baseline`}
                  />
                  <StatCard
                    icon="count"
                    color="var(--accent)"
                    label="Glaciers sampled"
                    value={stats.baselineCount != null ? stats.baselineCount.toLocaleString() : '—'}
                    sub={`${stats.baselineLabel} baseline`}
                  />
                </div>
              )}

              <div className="tplus-main">
                <div className="tplus-chart-wrap" ref={chartWrapRef}>
                  <svg
                    viewBox={`0 0 ${CHART_W} ${svgHeight}`}
                    width={chartSize.width}
                    height={chartSize.height}
                    onMouseMove={handleMove}
                    onMouseLeave={() => setActiveIndex(null)}
                    className="tplus-svg"
                  >
                    <defs>
                      <filter id="tplusGlow" x="-60%" y="-60%" width="220%" height="220%">
                        <feGaussianBlur stdDeviation="2.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    {active && (
                      <line
                        x1={xScale(activeIndex, n)} x2={xScale(activeIndex, n)}
                        y1={PAD_TOP} y2={CHART_H * 2 + 14 - PAD_BOTTOM}
                        className="tplus-crosshair"
                      />
                    )}

                    <g>
                      <LineChart
                        title={metric.chartTitle}
                        unit=""
                        values={periods.map((p) => p[metric.rateKey])}
                        color={GLACIER_COLOR}
                        formatValue={(v) => v.toFixed(2)}
                        activeIndex={activeIndex}
                      />
                    </g>
                    <g transform={`translate(0 ${CHART_H + 20})`}>
                      <LineChart
                        title="Mean temperature (°C)"
                        unit=""
                        values={periods.map((p) => p.meanTempC)}
                        color={TEMP_COLOR}
                        formatValue={(v) => v.toFixed(2)}
                        activeIndex={activeIndex}
                      />
                    </g>

                    {xTicks.map((t, i) => (
                      <text
                        key={i}
                        x={t.x}
                        y={svgHeight - 4}
                        textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
                        className="tplus-axis-label"
                      >
                        {t.label}
                      </text>
                    ))}
                  </svg>
                </div>

                <div className="tplus-side">
                  <div className="ds-section-title">Data table</div>
                  <table className="ds-table">
                    <thead>
                      <tr><th>Period</th><th>{metric.tableHeader}</th><th>Mean temp</th><th>Glaciers</th></tr>
                    </thead>
                    <tbody>
                      {periods.map((p, i) => (
                        <tr key={i}>
                          <td>{p.startYear}–{p.endYear}</td>
                          <td className={p[metric.rateKey] < 0 ? 'neg' : p[metric.rateKey] > 0 ? 'pos' : ''}>
                            {p[metric.rateKey] != null ? p[metric.rateKey].toFixed(metric.tableDecimals) : '—'}
                          </td>
                          <td>{p.meanTempC != null ? `${p.meanTempC.toFixed(2)} °C` : '—'}</td>
                          <td>{p.glacierCount?.toLocaleString() ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="ds-footer-note">
                    {metric.methodNote(scopeNote)} Temperature: ERA5-Land monthly
                    aggregates (ECMWF), averaged over the same region for each
                    period, via Google Earth Engine -- the same layer as the map's
                    annual-temperature overlay, used for every period here (not just
                    the one below) so the series doesn't jump where the source changes.
                    {stats?.hasRecentPeriod && ' The 2019–25 period comes from WGMS’s Annual Mass-Change Estimates (Dussaillant et al. 2025) rather than Hugonnet et al. (2021) directly -- real observations temporally downscaled with in-situ data, not a climate projection, covering essentially the same glacier population as the historical periods.'}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {active && tooltipPos && (
        <div className="tplus-floating-tooltip" style={{ left: tooltipPos.left, top: tooltipPos.top }}>
          <div className="tplus-tooltip-period">{active.startYear}–{active.endYear}</div>
          <div className="tplus-tooltip-row">
            <span className="tplus-key" style={{ background: GLACIER_COLOR }} />
            <span className="tplus-tooltip-label">{metric.tooltipLabel}</span>
            <span className="tplus-tooltip-value">{active[metric.rateKey]?.toFixed(metric.tableDecimals)}{metric.tooltipUnit}</span>
          </div>
          <div className="tplus-tooltip-row">
            <span className="tplus-key" style={{ background: TEMP_COLOR }} />
            <span className="tplus-tooltip-label">Mean temperature</span>
            <span className="tplus-tooltip-value">{active.meanTempC?.toFixed(2)} °C</span>
          </div>
          <div className="tplus-tooltip-row muted">
            <span className="tplus-tooltip-label">Glaciers sampled</span>
            <span className="tplus-tooltip-value">{active.glacierCount?.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}
