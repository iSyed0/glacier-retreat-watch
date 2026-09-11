import { useRef, useState } from 'react'

export default function Legend({
  era5,
  era5Visible,
  onToggleEra5,
  era5Opacity,
  onOpacityChange,
  era5Range,
  era5Month,
  onMonthChange,
  era5Date,
  era5Status,
  era5Error,
  boundaryVisible,
  onToggleBoundary,
  pkNationalVisible,
  onTogglePkNational,
  pkProvincesVisible,
  onTogglePkProvinces,
  pkDistrictsVisible,
  onTogglePkDistricts,
}) {
  const gradient = era5 ? `linear-gradient(to right, ${era5.palette.map((c) => '#' + c).join(',')})` : ''

  const panelRef = useRef(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [pos, setPos] = useState(null) // null = default bottom-left CSS position
  const [dragging, setDragging] = useState(false)

  const clamp = (left, top) => {
    const panel = panelRef.current
    const margin = 24
    if (!panel) return { left, top }
    const { width, height } = panel.getBoundingClientRect()
    const maxLeft = window.innerWidth - margin
    const maxTop = window.innerHeight - margin
    return {
      left: Math.min(Math.max(left, -width + margin), maxLeft),
      top: Math.min(Math.max(top, 0), maxTop),
    }
  }

  const handlePointerDown = (e) => {
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    setPos({ left: rect.left, top: rect.top })
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    if (!dragging) return
    setPos(clamp(e.clientX - dragOffset.current.x, e.clientY - dragOffset.current.y))
  }

  const handlePointerUp = (e) => {
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const panelStyle = pos ? { left: pos.left, top: pos.top, bottom: 'auto', right: 'auto' } : undefined

  const monthLabel = era5Status === 'loading'
    ? 'loading…'
    : era5Status === 'error'
      ? 'unavailable'
      : era5Date || era5Month

  return (
    <div id="legend" ref={panelRef} style={panelStyle}>
      <div
        className="legend-title legend-draghandle"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Drag to move"
      >
        Glacier status
      </div>
      <div className="legend-row"><span className="dot" /> Glacier location</div>
      <div className="legend-row"><span className="ring red" /> Retreating / thinning</div>
      <div className="legend-row"><span className="ring blue" /> Stable / gaining</div>
      <div className="legend-row" style={{ marginTop: 4, opacity: 0.75 }}>
        Numbered circles are clusters — click or zoom in
      </div>

      <div className="legend-title era5-row">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(255,204,0,0.15)', border: '1.5px solid #ffcc00', display: 'inline-block' }} />
          Study area boundary
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={boundaryVisible}
            onChange={(e) => onToggleBoundary(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </label>
      </div>

      <div className="legend-row" style={{ marginTop: 10, opacity: 0.75 }}>Pakistan admin boundaries</div>

      <div className="legend-title era5-row" style={{ marginTop: 4 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 2, background: '#ff8a00', display: 'inline-block' }} />
          National
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={pkNationalVisible}
            onChange={(e) => onTogglePkNational(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </label>
      </div>

      <div className="legend-title era5-row">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 2, background: '#c264ff', display: 'inline-block' }} />
          Provinces
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={pkProvincesVisible}
            onChange={(e) => onTogglePkProvinces(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </label>
      </div>

      <div className="legend-title era5-row">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 2, background: '#8ea3b6', display: 'inline-block' }} />
          Districts
        </span>
        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={pkDistrictsVisible}
            onChange={(e) => onTogglePkDistricts(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </label>
      </div>

      {era5 && (
        <>
          <div className="legend-title era5-row">
            <span>ERA5 temp (2m{monthLabel ? `, ${monthLabel}` : ''})</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={era5Visible}
                onChange={(e) => onToggleEra5(e.target.checked)}
                style={{ cursor: 'pointer' }}
              />
            </label>
          </div>

          {era5Visible && (
            <div id="era5-controls">
              {era5Range && (
                <div className="era5-field">
                  <label htmlFor="era5-month">Month</label>
                  <input
                    id="era5-month"
                    type="month"
                    min={era5Range.min}
                    max={era5Range.max}
                    value={era5Month || ''}
                    onChange={(e) => e.target.value && onMonthChange(e.target.value)}
                  />
                </div>
              )}

              {era5Status === 'error' && (
                <div className="era5-error">No data for that month{era5Error ? ` — ${era5Error}` : ''}</div>
              )}

              <div className="era5-field">
                <label htmlFor="era5-opacity">Opacity</label>
                <input
                  id="era5-opacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={era5Opacity}
                  onChange={(e) => onOpacityChange(Number(e.target.value))}
                />
                <span className="era5-opacity-value">{Math.round(era5Opacity * 100)}%</span>
              </div>

              <div id="era5-scale">
                <div className="era5-scale-bar" style={{ background: gradient }} />
                <div className="era5-scale-labels">
                  <span>{era5.minC}°C</span>
                  <span>{era5.maxC}°C</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
