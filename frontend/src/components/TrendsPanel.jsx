import { useEffect, useMemo, useRef, useState } from 'react'

// Colors validated (node scripts/validate_palette.js) against this app's
// actual dark panel background (#0f151c): blue/orange clear every CVD and
// contrast check as a pair. Blue reads as ice/cold for the glacier series,
// orange as heat for temperature -- identity is legible even before reading
// the legend.
const GLACIER_COLOR = '#3987e5'
const TEMP_COLOR = '#d95926'

const CHART_W = 520
const CHART_H = 108
const PAD_L = 46
const PAD_R = 16
const PAD_TOP = 14
const PAD_BOTTOM = 10
// A cap on rendered chart height -- without it, full screen (much wider
// container) scales the chart's height right along with its width, since
// it keeps the same proportions, and the whole panel ends up taller than
// the viewport. In full screen the actual available height is measured
// instead (the chart wrapper stretches to fill its flex row -- see
// .trends-modal.fullscreen .trends-body in App.css), so the chart uses
// exactly the real budget at any window size; this fixed cap is only for
// the normal (stacked) layout, where the wrapper is sized by its own
// content rather than stretched.
const CHART_MAX_H = 420

function periodLabel(p) {
  return `${p.startYear}–${p.endYear}`
}

// Shared x positions (one per period) so the two stacked charts -- and the
// crosshair between them -- line up exactly.
function xScale(i, n) {
  const usable = CHART_W - PAD_L - PAD_R
  return n <= 1 ? PAD_L : PAD_L + (usable * i) / (n - 1)
}

function yScale(value, min, max) {
  const usable = CHART_H - PAD_TOP - PAD_BOTTOM
  if (max === min) return PAD_TOP + usable / 2
  return PAD_TOP + usable * (1 - (value - min) / (max - min))
}

function LineChart({ title, unit, values, color, formatValue, activeIndex }) {
  const nums = values.filter((v) => v != null)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  // A little headroom so the line doesn't touch the plot edges.
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
      <text x={PAD_L} y={PAD_TOP - 4} className="trends-chart-title">{title}</text>
      {points.map((p, i) => p && (
        <line
          key={`grid-${i}`}
          x1={p[0]} x2={p[0]}
          y1={PAD_TOP} y2={CHART_H - PAD_BOTTOM}
          className="trends-gridline"
        />
      ))}
      {linePath && <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
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
      {/* Endpoint labels only -- first and last -- per the "label selectively" rule */}
      {firstIdx >= 0 && (
        <text x={points[firstIdx][0]} y={points[firstIdx][1] - 10} textAnchor="start" className="trends-value-label">
          {formatValue(values[firstIdx])}{unit}
        </text>
      )}
      {lastIdx !== firstIdx && lastIdx >= 0 && (
        <text x={points[lastIdx][0]} y={points[lastIdx][1] - 10} textAnchor="end" className="trends-value-label">
          {formatValue(values[lastIdx])}{unit}
        </text>
      )}
    </g>
  )
}

// Floating tooltip's assumed footprint, used to flip it to whichever side of
// the cursor keeps it fully on-screen -- cheaper than measuring the actual
// rendered box, and this tooltip's size barely varies (period + 3 rows).
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

export default function TrendsPanel({ open, onClose, data, status, error }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const [tooltipPos, setTooltipPos] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Draggable via the header, same pattern as the Legend panel: null pos
  // means "use the default CSS position" (centered), and a drag switches it
  // to an explicit fixed pixel position. Disabled while fullscreen -- there's
  // nowhere to drag to, and toggling fullscreen resets any prior drag so it
  // doesn't leave the panel stranded off-position when un-maximized.
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

  const svgHeight = CHART_H * 2 + 34 // two charts + gap/x-axis band
  const chartRatio = CHART_W / svgHeight

  // Measures the wrapper's actual width (it's just the modal body's content
  // width outside fullscreen, but grows a lot in fullscreen) and derives the
  // chart's rendered pixel size from it -- capped at CHART_MAX_H so a wide
  // container doesn't also mean a tall one; width is then derived back from
  // the capped height, and the chart sits centered in the leftover width.
  const chartWrapRef = useRef(null)
  const [chartSize, setChartSize] = useState({ width: CHART_W, height: svgHeight })

  useEffect(() => {
    const el = chartWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => {
      const containerWidth = el.clientWidth
      if (!containerWidth) return
      // Full screen: the wrapper is stretched to fill its flex row (see
      // App.css), so its own clientHeight is a real measurement of the
      // space actually available -- not a guess. Normal layout: the
      // wrapper is sized by its content, so there's nothing to measure;
      // fall back to the fixed cap instead.
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
    <div className="trends-overlay" onClick={onClose}>
      <div
        className={`trends-modal${isFullscreen ? ' fullscreen' : ''}`}
        ref={modalRef}
        style={modalStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="trends-header"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          title={isFullscreen ? undefined : 'Drag to move'}
        >
          <div>
            <div className="trends-title">Glacier change vs. temperature</div>
            <div className="trends-sub">HKH region · 1999–2019</div>
          </div>
          <div className="trends-header-actions">
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

        <div className="trends-body">
          {status === 'loading' && <div className="ds-empty">Loading…</div>}
          {status === 'error' && <div className="era5-error">Trend data unavailable{error ? ` — ${error}` : ''}</div>}

          {status === 'ready' && n > 0 && (
            <>
              <div className="trends-chart-wrap" ref={chartWrapRef}>
              <svg
                viewBox={`0 0 ${CHART_W} ${svgHeight}`}
                width={chartSize.width}
                height={chartSize.height}
                onMouseMove={handleMove}
                onMouseLeave={() => setActiveIndex(null)}
                className="trends-svg"
              >
                {/* Shared crosshair spans both charts */}
                {active && (
                  <line
                    x1={xScale(activeIndex, n)} x2={xScale(activeIndex, n)}
                    y1={PAD_TOP} y2={CHART_H * 2 + 14 - PAD_BOTTOM}
                    className="trends-crosshair"
                  />
                )}

                <g>
                  <LineChart
                    title="Elevation change rate (m/yr)"
                    unit=""
                    values={periods.map((p) => p.elevationChangeRateM)}
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
                    className="trends-axis-label"
                  >
                    {t.label}
                  </text>
                ))}
              </svg>
              </div>

              {/* Beside the chart (not below it) in full screen -- see
                  .trends-modal.fullscreen .trends-body in App.css -- and
                  compacted there too (smaller type, tighter rows), since the
                  chart is the point and the table is backup detail. */}
              <div className="trends-side">
                <div className="ds-section-title">Data table</div>
                <table className="ds-table">
                  <thead>
                    <tr><th>Period</th><th>Elev. Δ (m/yr)</th><th>Mean temp</th><th>Glaciers</th></tr>
                  </thead>
                  <tbody>
                    {periods.map((p, i) => (
                      <tr key={i}>
                        <td>{p.startYear}–{p.endYear}</td>
                        <td className={p.elevationChangeRateM < 0 ? 'neg' : p.elevationChangeRateM > 0 ? 'pos' : ''}>
                          {p.elevationChangeRateM != null ? p.elevationChangeRateM.toFixed(3) : '—'}
                        </td>
                        <td>{p.meanTempC != null ? `${p.meanTempC.toFixed(2)} °C` : '—'}</td>
                        <td>{p.glacierCount?.toLocaleString() ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="ds-footer-note">
                  Elevation change: area-weighted mean across every HKH glacier with a
                  figure for that period (Hugonnet et al. 2021), the actual resolution
                  the satellite record supports -- not truly annual. Temperature: ERA5
                  monthly reanalysis (ECMWF), averaged over the HKH boundary for each
                  period, via Google Earth Engine.
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Fixed-position, follows the cursor -- lives outside the scrollable
          modal body so it's never clipped by overflow:auto, and flips to
          whichever side of the cursor keeps it on-screen. */}
      {active && tooltipPos && (
        <div className="trends-floating-tooltip" style={{ left: tooltipPos.left, top: tooltipPos.top }}>
          <div className="trends-tooltip-period">{active.startYear}–{active.endYear}</div>
          <div className="trends-tooltip-row">
            <span className="trends-key" style={{ background: GLACIER_COLOR }} />
            <span className="trends-tooltip-label">Elevation Δ</span>
            <span className="trends-tooltip-value">{active.elevationChangeRateM?.toFixed(3)} m/yr</span>
          </div>
          <div className="trends-tooltip-row">
            <span className="trends-key" style={{ background: TEMP_COLOR }} />
            <span className="trends-tooltip-label">Mean temperature</span>
            <span className="trends-tooltip-value">{active.meanTempC?.toFixed(2)} °C</span>
          </div>
          <div className="trends-tooltip-row muted">
            <span className="trends-tooltip-label">Glaciers sampled</span>
            <span className="trends-tooltip-value">{active.glacierCount?.toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  )
}
