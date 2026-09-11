import { useRef, useState } from 'react'

function Toggle({ checked, onChange, label }) {
  return (
    <label className="toggle-switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="thumb" />
    </label>
  )
}

function LayerRow({ swatch, label, checked, onChange, indent }) {
  return (
    <div className={`layer-row${indent ? ' indent' : ''}`}>
      <span className="layer-row-main">
        {swatch}
        <span className="layer-row-label">{label}</span>
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

function Chevron({ open, mini }) {
  return (
    <svg
      className={`chevron${open ? ' open' : ''}${mini ? ' mini' : ''}`}
      width={mini ? 11 : 14}
      height={mini ? 11 : 14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

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
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('hkh-legend-collapsed') === '1'
    } catch {
      return false
    }
  })
  const pkAnyVisible = pkNationalVisible || pkProvincesVisible || pkDistrictsVisible
  const [pkOpen, setPkOpen] = useState(pkAnyVisible)

  const setCollapsedPersist = (next) => {
    setCollapsed(next)
    try {
      localStorage.setItem('hkh-legend-collapsed', next ? '1' : '0')
    } catch {
      // ignore -- private browsing / storage disabled
    }
  }

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

  const lineSwatch = (color) => <span className="swatch line" style={{ background: color }} />

  return (
    <div id="legend" className={collapsed ? 'collapsed' : ''} ref={panelRef} style={panelStyle}>
      <div
        className="legend-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Drag to move"
      >
        <span className="legend-header-title">Glacier status</span>
        <button
          type="button"
          className="legend-collapse-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setCollapsedPersist(!collapsed)}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <Chevron open={!collapsed} />
        </button>
      </div>

      {!collapsed && (
        <div className="legend-body">
          <div className="legend-section">
            <div className="legend-row"><span className="dot" /> Glacier location</div>
            <div className="legend-row"><span className="ring red" /> Retreating / thinning</div>
            <div className="legend-row"><span className="ring blue" /> Stable / gaining</div>
            <div className="legend-hint">Numbered circles are clusters — click or zoom in</div>
          </div>

          <div className="legend-section">
            <div className="legend-section-title">Layers</div>

            <LayerRow
              swatch={<span className="swatch boundary" />}
              label="Study area boundary"
              checked={boundaryVisible}
              onChange={onToggleBoundary}
            />

            <div className="legend-group">
              <button type="button" className="legend-group-toggle" onClick={() => setPkOpen((o) => !o)}>
                <Chevron open={pkOpen} mini />
                <span>Pakistan boundaries</span>
              </button>
              {pkOpen && (
                <div className="legend-group-body">
                  <LayerRow indent swatch={lineSwatch('#ff8a00')} label="National" checked={pkNationalVisible} onChange={onTogglePkNational} />
                  <LayerRow indent swatch={lineSwatch('#c264ff')} label="Provinces" checked={pkProvincesVisible} onChange={onTogglePkProvinces} />
                  <LayerRow indent swatch={lineSwatch('#8ea3b6')} label="Districts" checked={pkDistrictsVisible} onChange={onTogglePkDistricts} />
                </div>
              )}
            </div>

            {era5 && (
              <>
                <LayerRow
                  swatch={<span className="swatch gradient" style={{ background: gradient }} />}
                  label={`ERA5 temp (2m${monthLabel ? `, ${monthLabel}` : ''})`}
                  checked={era5Visible}
                  onChange={onToggleEra5}
                />

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
        </div>
      )}
    </div>
  )
}
