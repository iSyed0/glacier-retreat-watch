import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import {
  estimateMassBalanceDensity,
  formatMassRateGt,
  massBalanceSeverityFraction,
  massBalanceTier,
} from '../glacierMassBalance'

// mapbox-gl is a singleton module, so this would already be set by
// MapView.jsx by the time this component could ever open -- set
// explicitly anyway rather than relying on that import-order side effect.
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Full-screen 360 terrain view, available from any glacier's card (see
// DataSheet.jsx's Mass Balance tab) -- NOT drone footage (no aerial/drone
// imagery dataset exists for these glaciers anywhere in this project),
// but a genuinely real 3D scene: Mapbox's satellite imagery draped over
// Mapbox's own terrain-DEM. The camera starts zoomed out on the globe and
// flies in (the same camera.fly()-style entrance Mapbox's own SDK
// examples use), lands on the clicked glacier, orbits it briefly, then
// flies to the nearest real glacier with the *opposite* trend (see
// /api/nearest-glacier, nearest_glacier.py) and back, looping -- a live
// version of the avalanche-nourishment/debris-insulation/aspect
// divergence explanation saved for the user's presentation. Clicked a
// retreating (or no-trend) glacier -> seeks the nearest balanced one;
// clicked a balanced glacier -> seeks the nearest retreating one.
const ROTATE_DEGREES_PER_MS = 360 / 40000 // one full orbit every 40s
const FLY_IN_DURATION_MS = 7500
const FLY_BETWEEN_DURATION_MS = 9500
// How far out the camera pulls back at the midpoint of the flight between
// stops (both ends sit at zoom 14, so without this flyTo has little reason
// to arc up and tends to pan low and fast between nearby points, which
// reads as jerky rather than a smooth "flight"). Only applied between
// stops -- the initial globe entrance already arcs naturally since it
// starts at zoom ~1.
const BETWEEN_STOPS_MIN_ZOOM = 8.5
const HOLD_MS = 8000 // time spent orbiting each stop before flying onward
const MAX_NEIGHBOR_KM = 50

export default function TerrainView({ feature, onClose }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const compassRef = useRef(null)
  const playPauseRef = useRef(null)
  const elevationRef = useRef(null)
  const tempRef = useRef(null)
  const titleRef = useRef(null)
  const subRef = useRef(null)
  const badgeRef = useRef(null)
  const rateRef = useRef(null)
  const areaRef = useRef(null)
  const balanceRef = useRef(null)
  const massRef = useRef(null)
  const meltRef = useRef(null)
  const meltTargetRef = useRef(null) // { lon, lat } of the stop the melt overlay is anchored to

  useEffect(() => {
    if (!feature) return
    const firstStop = {
      lon: feature.lon,
      lat: feature.lat,
      name: feature.name,
      country: feature.country,
      trend: feature.trend,
      rate: feature.rate,
      area: feature.area,
      specificBalanceStr: feature.specificBalanceStr,
      massLossStr: feature.massLossStr,
    }
    // Balanced glaciers get a retreating counterpart; anything else
    // (retreating, or no significant trend) gets a balanced one -- either
    // way the tour pairs the clicked glacier with the opposite case.
    const searchTrend = feature.trend === 1 ? -1 : 1

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      projection: 'globe',
      // Start directly over the glacier, zoomed out -- the entrance flight is
      // then a pure zoom-in on the glacier. Starting at a different latitude
      // or longitude let the globe-projection flight take the long way round
      // and sweep past the other side before reaching the target.
      center: [firstStop.lon, firstStop.lat],
      zoom: 2.5,
      pitch: 0,
      bearing: 0,
      attributionControl: true,
    })
    mapRef.current = map

    let cancelled = false
    let animationId = null
    let autoRotate = true // toggled by clicking the map -- persists until clicked again
    let dragging = false // true only while actively dragging/pitching
    let flying = false // true for the duration of any flyTo -- our own setBearing
    // every frame otherwise fights Mapbox's own camera interpolation during
    // the flight, which froze the translation in place while still spinning
    let rotating = false // whether the orbit tick loop is running yet
    let lastTs = null
    let tourTimer = null
    let secondStop = null // filled in once /api/nearest-glacier resolves

    function updatePlayPauseLabel() {
      if (playPauseRef.current) {
        playPauseRef.current.textContent = autoRotate ? '⏸ Click to pause rotation' : '▶ Click to resume rotation'
      }
    }

    function tick(ts) {
      if (lastTs == null) lastTs = ts
      const dt = ts - lastTs
      lastTs = ts
      if (autoRotate && !dragging && !flying) {
        map.setBearing((map.getBearing() + ROTATE_DEGREES_PER_MS * dt) % 360)
      }
      if (compassRef.current) {
        compassRef.current.textContent = `${Math.round(map.getBearing() + 360) % 360}°`
      }
      animationId = requestAnimationFrame(tick)
    }

    function startRotating() {
      if (rotating) return
      rotating = true
      lastTs = null
      animationId = requestAnimationFrame(tick)
      updatePlayPauseLabel()
    }

    function onDragStart() { dragging = true }
    function onDragEnd() { dragging = false; lastTs = null }
    function onClick() {
      autoRotate = !autoRotate
      updatePlayPauseLabel()
    }

    function updateInfoPanel(stop) {
      if (titleRef.current) titleRef.current.textContent = stop.name || 'Unnamed Glacier'
      if (subRef.current) {
        subRef.current.textContent = `${stop.country ? stop.country + ' · ' : ''}${stop.lat.toFixed(3)}°, ${stop.lon.toFixed(3)}° -- 3D orbit (satellite imagery + terrain, not drone footage)`
      }
      const trendLabel = stop.trend === -1 ? 'Retreating / Thinning' : stop.trend === 1 ? 'Balanced' : 'No significant trend'
      const trendClass = stop.trend === -1 ? 'dec' : stop.trend === 1 ? 'inc' : 'stb'
      if (badgeRef.current) {
        badgeRef.current.className = `ds-badge ${trendClass}`
        badgeRef.current.textContent = trendLabel
      }
      if (rateRef.current) rateRef.current.textContent = stop.rate != null ? stop.rate.toFixed(2) + ' m/yr' : '—'
      if (areaRef.current) areaRef.current.textContent = stop.area != null ? stop.area.toFixed(2) + ' km²' : '—'
      if (balanceRef.current) balanceRef.current.textContent = stop.specificBalanceStr || '—'
      if (massRef.current) massRef.current.textContent = stop.massLossStr || '—'
      if (elevationRef.current) elevationRef.current.textContent = '…'
      if (tempRef.current) tempRef.current.textContent = '…'

      fetch(`/api/hover-info?lon=${stop.lon}&lat=${stop.lat}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled || !data) return
          if (elevationRef.current) elevationRef.current.textContent = data.elevationM != null ? `${Math.round(data.elevationM)} m` : '—'
          if (tempRef.current) tempRef.current.textContent = data.tempC != null ? `${data.tempC.toFixed(1)}°C` : '—'
        })
        .catch(() => {})
    }

    // Melt overlay: anchored to the glacier's screen position, faded in by
    // zoom (so it appears as the camera closes in), and styled by the same
    // severity tiers as the Mass Balance tab's icon. Balanced/unknown stops
    // get no melt at all.
    function setMeltFor(stop) {
      const el = meltRef.current
      if (!el) return
      const density = estimateMassBalanceDensity({ rate: stop.rate, area: stop.area })
      const mwe = density ? density.specificBalanceMWe : null
      const tier = massBalanceTier(mwe)
      const fraction = massBalanceSeverityFraction(mwe)
      meltTargetRef.current = { lon: stop.lon, lat: stop.lat }
      el.className = tier === 'stable' || tier === 'unknown' ? 'melt-off' : `melt-${tier}`
      el.style.setProperty('--melt-scale', String(0.55 + 0.9 * fraction))
      updateMelt()
    }

    function updateMelt() {
      const el = meltRef.current
      const container = containerRef.current
      const target = meltTargetRef.current
      if (!el || !container || !target) return
      const p = map.project([target.lon, target.lat])
      el.style.left = `${container.offsetLeft + p.x}px`
      el.style.top = `${container.offsetTop + p.y}px`
      const z = map.getZoom()
      el.style.opacity = String(Math.max(0, Math.min(1, (z - 10.5) / 2)))
    }

    function flyToStop(stop, duration, onArrive, extraFlyOptions = {}) {
      flying = true
      setMeltFor(stop)
      map.flyTo({ center: [stop.lon, stop.lat], zoom: 14, pitch: 65, duration, essential: true, ...extraFlyOptions })
      tourTimer = setTimeout(() => {
        if (cancelled) return
        flying = false
        lastTs = null
        onArrive()
      }, duration)
    }

    function arriveAt(stop) {
      updateInfoPanel(stop)
      startRotating()
      scheduleNext(stop)
    }

    function scheduleNext(currentStop) {
      tourTimer = setTimeout(() => {
        if (cancelled) return
        if (!secondStop) return // no qualifying neighbor -- stay put, keep orbiting
        const next = currentStop === firstStop ? secondStop : firstStop
        flyToStop(next, FLY_BETWEEN_DURATION_MS, () => arriveAt(next), { minZoom: BETWEEN_STOPS_MIN_ZOOM })
      }, HOLD_MS)
    }

    map.on('load', () => {
      map.addSource('terrain-view-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
        tileSize: 512,
        maxzoom: 14,
      })
      map.setTerrain({ source: 'terrain-view-dem', exaggeration: 1.5 })

      flyToStop(firstStop, FLY_IN_DURATION_MS, () => arriveAt(firstStop))
    })

    map.on('dragstart', onDragStart)
    map.on('dragend', onDragEnd)
    map.on('pitchstart', onDragStart)
    map.on('pitchend', onDragEnd)
    map.on('click', onClick)
    map.on('move', updateMelt)

    // The real version of the divergence case (a glacier near one or
    // more with the opposite trend) -- the nearest actual glacier of the
    // opposite trend, not a scripted example. If none is within range,
    // the tour just stays on the clicked glacier (scheduleNext checks
    // secondStop).
    fetch(`/api/nearest-glacier?lon=${firstStop.lon}&lat=${firstStop.lat}&trend=${searchTrend}&max_km=${MAX_NEIGHBOR_KM}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((neighbor) => {
        if (cancelled || !neighbor) return
        const density = estimateMassBalanceDensity({ rate: neighbor.rate, area: neighbor.area })
        secondStop = {
          lon: neighbor.lon,
          lat: neighbor.lat,
          name: neighbor.name,
          country: neighbor.country,
          trend: neighbor.trend,
          rate: neighbor.rate,
          area: neighbor.area,
          specificBalanceStr: density ? (density.specificBalanceMWe > 0 ? '+' : '') + density.specificBalanceMWe.toFixed(2) + ' m w.e./yr' : '—',
          massLossStr: density ? formatMassRateGt(density.massLossTPerYr) : '—',
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (animationId) cancelAnimationFrame(animationId)
      if (tourTimer) clearTimeout(tourTimer)
      map.remove()
      mapRef.current = null
    }
  }, [feature])

  if (!feature) return null

  const initialTrendLabel = feature.trend === -1 ? 'Retreating / Thinning' : feature.trend === 1 ? 'Balanced' : 'No significant trend'
  const initialTrendClass = feature.trend === -1 ? 'dec' : feature.trend === 1 ? 'inc' : 'stb'

  return (
    <div id="terrain-view-overlay">
      <div id="terrain-view-header">
        <div>
          <div id="terrain-view-title" ref={titleRef}>{feature.name || 'Unnamed Glacier'}</div>
          <div id="terrain-view-sub" ref={subRef}>
            {feature.country ? `${feature.country} · ` : ''}
            {feature.lat.toFixed(3)}°, {feature.lon.toFixed(3)}° -- 3D orbit (satellite imagery + terrain, not drone footage)
          </div>
        </div>
        <button id="terrain-view-close" onClick={onClose} title="Close">✕</button>
      </div>

      <div id="terrain-view-info">
        <div className={`ds-badge ${initialTrendClass}`} ref={badgeRef}><span className="dotmini" /> {initialTrendLabel}</div>
        <div className="terrain-view-stat"><span className="k">Rate</span><span className="v" ref={rateRef}>{feature.rate != null ? feature.rate.toFixed(2) + ' m/yr' : '—'}</span></div>
        <div className="terrain-view-stat"><span className="k">Area</span><span className="v" ref={areaRef}>{feature.area != null ? feature.area.toFixed(2) + ' km²' : '—'}</span></div>
        <div className="terrain-view-stat"><span className="k">Mass balance (est.)</span><span className="v" ref={balanceRef}>{feature.specificBalanceStr || '—'}</span></div>
        <div className="terrain-view-stat"><span className="k">Mass change (est.)</span><span className="v" ref={massRef}>{feature.massLossStr || '—'}</span></div>
        <div className="terrain-view-stat"><span className="k">Elevation here</span><span className="v" ref={elevationRef}>…</span></div>
        <div className="terrain-view-stat"><span className="k">Temp here</span><span className="v" ref={tempRef}>…</span></div>
      </div>

      <div id="terrain-view-hud">
        <span id="terrain-view-compass" ref={compassRef}>0°</span>
        <span id="terrain-view-playpause" ref={playPauseRef}>⏸ Click to pause rotation</span>
      </div>

      <div id="terrain-view-melt" ref={meltRef} className="melt-off" aria-hidden="true">
        <svg viewBox="0 0 160 160" width="160" height="160">
          <ellipse className="melt-pool" cx="80" cy="82" rx="34" ry="11" fill="#4dd9ff" opacity="0.4" />
          <circle className="melt-drip melt-drip-1" cx="62" cy="88" r="3" fill="#4dd9ff" />
          <circle className="melt-drip melt-drip-2" cx="80" cy="90" r="3" fill="#4dd9ff" />
          <circle className="melt-drip melt-drip-3" cx="98" cy="88" r="3" fill="#4dd9ff" />
        </svg>
      </div>
      <div id="terrain-view-map" ref={containerRef} />
    </div>
  )
}
