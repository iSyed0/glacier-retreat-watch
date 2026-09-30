import { useRef, useState } from 'react'
import { BUILDINGS_MIN_ZOOM, BUILDINGS_HEIGHT_TIERS, SENSOR_LAYERS } from './MapView'

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className={`toggle-switch${disabled ? ' disabled' : ''}`} aria-label={label}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      <span className="thumb" />
    </label>
  )
}

function LayerRow({ swatch, label, checked, onChange, indent, disabled }) {
  return (
    <div className={`layer-row${indent ? ' indent' : ''}${disabled ? ' disabled' : ''}`}>
      <span className="layer-row-main">
        {swatch}
        <span className="layer-row-label" title={label}>{label}</span>
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
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

function CrosshairIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <line x1="12" y1="1.5" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22.5" y2="12" />
    </svg>
  )
}

export default function Legend({
  onRecenter,
  era5Annual,
  era5AnnualVisible,
  onToggleEra5Annual,
  era5AnnualOpacity,
  onEra5AnnualOpacityChange,
  era5AnnualYear,
  boundaryVisible,
  onToggleBoundary,
  pkNationalVisible,
  onTogglePkNational,
  pkProvincesVisible,
  onTogglePkProvinces,
  pkDistrictsVisible,
  onTogglePkDistricts,
  buildingsVisible,
  onToggleBuildings,
  buildingsStatus,
  buildingsError,
  buildingsCount,
  mapZoom,
  popRaster,
  popRasterVisible,
  onTogglePopRaster,
  popRasterOpacity,
  onPopRasterOpacityChange,
  popRasterStatus,
  popRasterError,
  landcoverEsri,
  landcoverEsriVisible,
  onToggleLandcoverEsri,
  landcoverEsriOpacity,
  onLandcoverEsriOpacityChange,
  landcoverEsriStatus,
  landcoverEsriError,
  landcoverEsa,
  landcoverEsaVisible,
  onToggleLandcoverEsa,
  landcoverEsaOpacity,
  onLandcoverEsaOpacityChange,
  landcoverEsaStatus,
  landcoverEsaError,
  sensorsGlof2Visible,
  onToggleSensorsGlof2,
  sensorsGlof2DamagedVisible,
  onToggleSensorsGlof2Damaged,
  sensorsBriFfVisible,
  onToggleSensorsBriFf,
  sensorsFocus2026Visible,
  onToggleSensorsFocus2026,
  sensorsGmrcWapdaVisible,
  onToggleSensorsGmrcWapda,
  riversVisible,
  onToggleRivers,
  rgi7HkhRegionsVisible,
  onToggleRgi7HkhRegions,
}) {
  const era5AnnualGradient = era5Annual ? `linear-gradient(to right, ${era5Annual.palette.map((c) => '#' + c).join(',')})` : ''
  const popRasterGradient = popRaster ? `linear-gradient(to right, ${popRaster.palette.map((c) => '#' + c).join(',')})` : ''

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
  const sensorsAnyVisible = sensorsGlof2Visible || sensorsGlof2DamagedVisible || sensorsBriFfVisible || sensorsFocus2026Visible || sensorsGmrcWapdaVisible
  const [sensorsOpen, setSensorsOpen] = useState(sensorsAnyVisible)

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

  const lineSwatch = (color) => <span className="swatch line" style={{ background: color }} />
  const dotSwatch = (color) => <span className="swatch dot-color" style={{ background: color + '33', borderColor: color }} />
  // A 3x3 grid of class colors -- land cover has exactly 9 classes, so this
  // doubles as a "this is categorical, not a gradient" visual cue.
  const classGridSwatch = (colors) => (
    <span className="swatch class-grid">
      {colors.map((c, i) => <span key={i} style={{ background: '#' + c }} />)}
    </span>
  )
  const sensorColor = Object.fromEntries(SENSOR_LAYERS.map((l) => [l.key, l.color]))

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
        <span className="legend-header-actions">
          <button
            type="button"
            className="legend-icon-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRecenter?.() }}
            aria-label="Center on HKH region"
            title="Center on HKH region"
          >
            <CrosshairIcon />
          </button>
          <button
            type="button"
            className="legend-icon-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsedPersist(!collapsed)}
            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <Chevron open={!collapsed} />
          </button>
        </span>
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

            <LayerRow
              swatch={lineSwatch('#00b8ff')}
              label="Rivers / canals / nallas"
              checked={riversVisible}
              onChange={onToggleRivers}
            />

            <LayerRow
              swatch={lineSwatch('#14b8a6')}
              label="RGI7 HKH glaciated region"
              checked={rgi7HkhRegionsVisible}
              onChange={onToggleRgi7HkhRegions}
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

            <div className="legend-group">
              <button type="button" className="legend-group-toggle" onClick={() => setSensorsOpen((o) => !o)}>
                <Chevron open={sensorsOpen} mini />
                <span>Sensors &amp; monitoring stations</span>
              </button>
              {sensorsOpen && (
                <div className="legend-group-body">
                  <LayerRow indent swatch={dotSwatch(sensorColor.glof2)} label="GLOF-II network stations" checked={sensorsGlof2Visible} onChange={onToggleSensorsGlof2} />
                  <LayerRow indent swatch={dotSwatch(sensorColor.glof2Damaged)} label="Damaged / stolen stations" checked={sensorsGlof2DamagedVisible} onChange={onToggleSensorsGlof2Damaged} />
                  <LayerRow indent swatch={dotSwatch(sensorColor.briFf)} label="BRI flash-flood stations" checked={sensorsBriFfVisible} onChange={onToggleSensorsBriFf} />
                  <LayerRow indent swatch={dotSwatch(sensorColor.focus2026)} label="2026 focus villages (hazard)" checked={sensorsFocus2026Visible} onChange={onToggleSensorsFocus2026} />
                  <LayerRow indent swatch={dotSwatch(sensorColor.gmrcWapda)} label="GM-RC / WAPDA stations" checked={sensorsGmrcWapdaVisible} onChange={onToggleSensorsGmrcWapda} />
                </div>
              )}
            </div>

            <LayerRow
              swatch={<span className="swatch buildings" />}
              label="Buildings"
              checked={buildingsVisible}
              onChange={onToggleBuildings}
              disabled={buildingsStatus !== 'ready'}
            />
            {buildingsVisible && buildingsStatus === 'ready' && (
              mapZoom != null && mapZoom < BUILDINGS_MIN_ZOOM ? (
                <div className="legend-hint active">
                  Zoom in to see footprints — z{mapZoom.toFixed(1)} of {BUILDINGS_MIN_ZOOM}+ needed
                </div>
              ) : (
                <div className="legend-hint">{buildingsCount ? `${buildingsCount} districts loaded` : 'Footprints visible'}</div>
              )
            )}
            {buildingsStatus === 'error' && (
              <div className="era5-error">Buildings unavailable{buildingsError ? ` — ${buildingsError}` : ''}</div>
            )}
            {buildingsVisible && buildingsStatus === 'ready' && (
              <div className="legend-group-body building-tiers">
                {BUILDINGS_HEIGHT_TIERS.map((tier) => (
                  <div className="legend-row" key={tier.label}>
                    <span className="swatch buildings" style={{ background: tier.color, borderColor: tier.color }} />
                    {tier.label} <span className="tier-range">({tier.range})</span>
                  </div>
                ))}
              </div>
            )}

            {popRaster && (
              <>
                <LayerRow
                  swatch={<span className="swatch gradient" style={{ background: popRasterGradient }} />}
                  label="Population"
                  checked={popRasterVisible}
                  onChange={onTogglePopRaster}
                  disabled={popRasterStatus !== 'ready'}
                />
                {popRasterStatus === 'error' && (
                  <div className="era5-error">Population unavailable{popRasterError ? ` — ${popRasterError}` : ''}</div>
                )}
                {popRasterVisible && popRasterStatus === 'ready' && (
                  <div id="era5-controls">
                    <div className="era5-field">
                      <label htmlFor="pop-raster-opacity">Opacity</label>
                      <input
                        id="pop-raster-opacity"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={popRasterOpacity}
                        onChange={(e) => onPopRasterOpacityChange(Number(e.target.value))}
                      />
                      <span className="era5-opacity-value">{Math.round(popRasterOpacity * 100)}%</span>
                    </div>
                    <div id="era5-scale">
                      <div className="era5-scale-bar" style={{ background: popRasterGradient }} />
                      <div className="era5-scale-labels">
                        <span>0</span>
                        <span>{popRaster.maxDensity.toLocaleString()}+ /km²</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {landcoverEsri && (
              <>
                <LayerRow
                  swatch={classGridSwatch(landcoverEsri.classes.map((c) => c.color))}
                  label={`Land cover — Esri (${landcoverEsri.maxYear})`}
                  checked={landcoverEsriVisible}
                  onChange={onToggleLandcoverEsri}
                />
                {landcoverEsriVisible && (
                  <div id="era5-controls">
                    {landcoverEsriStatus === 'loading' && <div className="era5-hint">Loading…</div>}
                    {landcoverEsriStatus === 'error' && (
                      <div className="era5-error">Land cover unavailable{landcoverEsriError ? ` — ${landcoverEsriError}` : ''}</div>
                    )}

                    <div className="era5-field">
                      <label htmlFor="landcover-esri-opacity">Opacity</label>
                      <input
                        id="landcover-esri-opacity"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={landcoverEsriOpacity}
                        onChange={(e) => onLandcoverEsriOpacityChange(Number(e.target.value))}
                      />
                      <span className="era5-opacity-value">{Math.round(landcoverEsriOpacity * 100)}%</span>
                    </div>

                    <div className="landcover-classes">
                      {landcoverEsri.classes.map((c) => (
                        <div key={c.value} className="landcover-class-row">
                          <span className="landcover-class-swatch" style={{ background: '#' + c.color }} />
                          <span>{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {landcoverEsa && (
              <>
                <LayerRow
                  swatch={classGridSwatch(landcoverEsa.classes.map((c) => c.color))}
                  label="Land cover — ESA WorldCover (2021)"
                  checked={landcoverEsaVisible}
                  onChange={onToggleLandcoverEsa}
                />
                {landcoverEsaVisible && (
                  <div id="era5-controls">
                    {landcoverEsaStatus === 'loading' && <div className="era5-hint">Loading…</div>}
                    {landcoverEsaStatus === 'error' && (
                      <div className="era5-error">Land cover unavailable{landcoverEsaError ? ` — ${landcoverEsaError}` : ''}</div>
                    )}

                    <div className="era5-field">
                      <label htmlFor="landcover-esa-opacity">Opacity</label>
                      <input
                        id="landcover-esa-opacity"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={landcoverEsaOpacity}
                        onChange={(e) => onLandcoverEsaOpacityChange(Number(e.target.value))}
                      />
                      <span className="era5-opacity-value">{Math.round(landcoverEsaOpacity * 100)}%</span>
                    </div>

                    <div className="landcover-classes">
                      {landcoverEsa.classes.map((c) => (
                        <div key={c.value} className="landcover-class-row">
                          <span className="landcover-class-swatch" style={{ background: '#' + c.color }} />
                          <span>{c.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {era5Annual && (
              <>
                <LayerRow
                  swatch={<span className="swatch gradient" style={{ background: era5AnnualGradient }} />}
                  label={`Annual temp (2m${era5AnnualYear != null ? `, ${era5AnnualYear}` : ''})`}
                  checked={era5AnnualVisible}
                  onChange={onToggleEra5Annual}
                />

                {era5AnnualVisible && (
                  <div id="era5-controls">
                    <div className="era5-hint">Year &amp; playback: bottom of map</div>

                    <div className="era5-field">
                      <label htmlFor="era5-annual-opacity">Opacity</label>
                      <input
                        id="era5-annual-opacity"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={era5AnnualOpacity}
                        onChange={(e) => onEra5AnnualOpacityChange(Number(e.target.value))}
                      />
                      <span className="era5-opacity-value">{Math.round(era5AnnualOpacity * 100)}%</span>
                    </div>

                    <div id="era5-scale">
                      <div className="era5-scale-bar" style={{ background: era5AnnualGradient }} />
                      <div className="era5-scale-labels">
                        <span>{era5Annual.minC}°C</span>
                        <span>{era5Annual.maxC}°C</span>
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
