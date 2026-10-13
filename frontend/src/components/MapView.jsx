import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { MAP_STYLES } from '../mapStyles'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Pakistan admin boundaries (D:\boundries) -- each is added to the map lazily,
// the first time its toggle is switched on, so the ~6MB districts layer in
// particular isn't fetched unless someone actually asks to see it.
const PK_LEVELS = [
  { key: 'national', url: '/api/boundaries/pakistan/national', color: '#ff8a00', lineWidth: 2, fillOpacity: 0.02 },
  { key: 'provinces', url: '/api/boundaries/pakistan/provinces', color: '#c264ff', lineWidth: 1.5, fillOpacity: 0.02 },
  { key: 'districts', url: '/api/boundaries/pakistan/districts', color: '#8ea3b6', lineWidth: 0.75, fillOpacity: 0 },
]

// Field sensor / monitoring-station networks (backend/app.py SENSOR_FILES)
// -- static GeoJSON point layers, each with its own property schema (see
// buildSensorPopupHtml below, which just renders whatever keys are present
// rather than assuming a shared shape across networks).
export const SENSOR_LAYERS = [
  { key: 'glof2', url: '/api/sensors/glof2', label: 'GLOF-II network stations', color: '#00d6ff' },
  { key: 'glof2Damaged', url: '/api/sensors/glof2-damaged', label: 'Damaged / stolen stations', color: '#ff1744' },
  { key: 'briFf', url: '/api/sensors/bri-ff', label: 'BRI flash-flood stations', color: '#ff7a00' },
  { key: 'focus2026', url: '/api/sensors/focus2026', label: '2026 focus villages (hazard)', color: '#e100ff' },
  { key: 'gmrcWapda', url: '/api/sensors/gmrc-wapda', label: 'GM-RC / WAPDA stations', color: '#ffe600' },
]

// River / canal / nalla polygons (backend RIVERS_FILE) -- one static layer,
// fetched lazily like the Pakistan districts boundary below since the
// source file is a hefty ~9MB.
const RIVERS_LAYER = { key: 'rivers', url: '/api/rivers', color: '#00b8ff' }

function addRiversLayer(map, beforeId) {
  const { url, color } = RIVERS_LAYER
  if (map.getLayer('rivers-line')) return
  map.addSource('rivers', { type: 'geojson', data: url })
  map.addLayer({
    id: 'rivers-fill',
    type: 'fill',
    source: 'rivers',
    paint: { 'fill-color': color, 'fill-opacity': 0.28 },
  }, beforeId)
  map.addLayer({
    id: 'rivers-line',
    type: 'line',
    source: 'rivers',
    paint: { 'line-color': color, 'line-width': 1, 'line-opacity': 0.9 },
  }, beforeId)

  map.on('mouseenter', 'rivers-fill', () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', 'rivers-fill', () => { map.getCanvas().style.cursor = '' })
  map.on('click', 'rivers-fill', (e) => {
    const { Name, Type } = e.features[0].properties
    new mapboxgl.Popup({ closeButton: true, maxWidth: '240px', className: 'sensor-popup-wrap' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="sensor-popup" style="--sensor-color: ${color}">
          <div class="sensor-popup-header">${escapeHtml(Name || 'River')}</div>
          <div class="sensor-popup-rows">
            <div class="sensor-popup-row"><span class="k">Type</span><span class="v">${escapeHtml(Type || 'Unknown')}</span></div>
          </div>
        </div>
      `)
      .addTo(map)
  })
}

// Properties come from hand-maintained field survey sheets, so keys vary
// network to network (StationNam vs. VillageNam vs. "Station Na", etc.) --
// rather than mapping each one, just render whatever's present. The header
// bar is tinted with the layer's own color (--sensor-color, read by
// App.css) so a popup is visually traceable back to its legend entry.
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function buildSensorPopupHtml({ label, color }, properties) {
  const rows = Object.entries(properties)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
    .map(([k, v]) => `<div class="sensor-popup-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`)
    .join('')
  return `
    <div class="sensor-popup" style="--sensor-color: ${color}">
      <div class="sensor-popup-header">${escapeHtml(label)}</div>
      <div class="sensor-popup-rows">${rows}</div>
    </div>
  `
}

function addSensorLayer(map, layer, beforeId) {
  const { key, url, color } = layer
  const layerId = `sensor-${key}`
  const centerLayerId = `${layerId}-center`
  if (map.getLayer(layerId)) return
  map.addSource(layerId, { type: 'geojson', data: url })
  map.addLayer({
    id: layerId,
    type: 'circle',
    source: layerId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 10, 8, 14, 12],
      'circle-color': color,
      'circle-opacity': 0.95,
      'circle-stroke-color': '#0b0f14',
      'circle-stroke-width': 1.5,
    },
  }, beforeId)

  // Purely decorative white center dot on top of each colored marker --
  // shares the same source/geometry, just a smaller circle drawn above it.
  // Click/hover handlers stay on the colored layer below (layerId), not
  // this one -- Mapbox resolves those per-layer at the click point
  // regardless of render order, so the dot doesn't need its own handlers.
  map.addLayer({
    id: centerLayerId,
    type: 'circle',
    source: layerId,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.6, 10, 3.2, 14, 4.8],
      'circle-color': '#ffffff',
      'circle-opacity': 0.95,
    },
  }, beforeId)

  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
  map.on('click', layerId, (e) => {
    const f = e.features[0]
    new mapboxgl.Popup({ closeButton: true, maxWidth: '280px', className: 'sensor-popup-wrap' })
      .setLngLat(f.geometry.coordinates)
      .setHTML(buildSensorPopupHtml(layer, f.properties))
      .addTo(map)
  })
}

// Building footprints -- one vector tileset per Pakistani district on an
// internal TileServer GL instance (see backend/buildings.py). Footprints
// are meaningless zoomed out, so the layer itself only renders past
// BUILDINGS_MIN_ZOOM; combined with each source's own `bounds`, that keeps
// 160+ district sources from requesting a single tile until the user is
// actually in view and zoomed in close. Rendered as 3D extrusions using
// each building's `height` field (falls back to a flat 6m where that's
// missing/zero) -- tilt the camera (right-click-drag, or two-finger drag on
// touch) to see them stand up; globe projection auto-switches to mercator
// well before this zoom, so fill-extrusion (mercator-only) is always in
// play by then.
export const BUILDINGS_MIN_ZOOM = 10
const BUILDINGS_DEFAULT_HEIGHT = 6

// Height tiers, sampled from the real data (max height across districts
// tops out around 55-85m -- Islamabad/Lahore/Karachi's tallest towers).
// Three distinct hues rather than one color ramped by brightness, so the
// classes read apart at a glance instead of blending together.
export const BUILDINGS_HEIGHT_TIERS = [
  { label: 'Small infrastructure', range: '< 12m', color: '#2dd4bf' },
  { label: 'Tall infrastructure', range: '12–35m', color: '#fbbf24' },
  { label: 'Skyscrapers', range: '35m+', color: '#d946ef' },
]

function addBuildingLayer(map, tileServer, id, bounds, beforeId) {
  const layerId = `bld-${id}`
  if (map.getLayer(layerId)) return
  map.addSource(layerId, {
    type: 'vector',
    tiles: [`${tileServer}/data/${id}/{z}/{x}/{y}.pbf`],
    bounds,
    minzoom: 2,
    maxzoom: 17,
  })
  // The effective (post-fallback) height in meters, shared by both the
  // extrusion height and its color class so what a building looks like
  // and what tier it's counted in never disagree.
  const effectiveHeight = ['max', ['coalesce', ['get', 'height'], BUILDINGS_DEFAULT_HEIGHT], 3]
  map.addLayer({
    id: layerId,
    type: 'fill-extrusion',
    source: layerId,
    'source-layer': 'buildings',
    minzoom: BUILDINGS_MIN_ZOOM,
    paint: {
      'fill-extrusion-color': [
        'step', effectiveHeight,
        BUILDINGS_HEIGHT_TIERS[0].color,
        12, BUILDINGS_HEIGHT_TIERS[1].color,
        35, BUILDINGS_HEIGHT_TIERS[2].color,
      ],
      // Buildings "grow" out of the ground over the first fraction of a
      // zoom level past BUILDINGS_MIN_ZOOM, same trick Mapbox's own 3D
      // buildings example uses, rather than popping in at full height.
      'fill-extrusion-height': [
        'interpolate', ['linear'], ['zoom'],
        BUILDINGS_MIN_ZOOM, 0,
        BUILDINGS_MIN_ZOOM + 0.1, effectiveHeight,
      ],
      'fill-extrusion-base': 0,
      // Stops relative to BUILDINGS_MIN_ZOOM (not hardcoded absolute zooms)
      // so they can't collide with it -- Mapbox GL rejects an "interpolate"
      // expression outright (the whole layer fails to add) if two stops
      // land on the same zoom value.
      'fill-extrusion-opacity': [
        'interpolate', ['linear'], ['zoom'],
        BUILDINGS_MIN_ZOOM, 0,
        BUILDINGS_MIN_ZOOM + 0.5, 0.85,
        BUILDINGS_MIN_ZOOM + 4, 0.92,
      ],
      'fill-extrusion-vertical-gradient': true,
    },
  }, beforeId)
}

// A native Mapbox GL control (rather than a React-positioned element) so it
// stacks automatically in the corner alongside NavigationControl -- no
// manual pixel math, and no risk of ever colliding with the Legend/
// BasemapSwitcher/DataSheet panels, which live in the other three corners.
class ZoomIndicatorControl {
  onAdd(map) {
    this._map = map
    this._container = document.createElement('div')
    this._container.className = 'mapboxgl-ctrl zoom-indicator-ctrl'
    this._update()
    this._onZoom = () => this._update()
    map.on('zoom', this._onZoom)
    return this._container
  }

  onRemove() {
    this._map.off('zoom', this._onZoom)
    this._container.parentNode?.removeChild(this._container)
    this._map = undefined
  }

  _update() {
    this._container.textContent = `Zoom ${this._map.getZoom().toFixed(1)}`
  }
}

// The annual-temperature layer plays through 28 years, so a hard cut
// between each year's imagery (the previous approach: swap one raster
// source's tiles and it just pops) reads as choppy. Only each year's tile
// *URL* is pre-fetched in one batch (see App.jsx) -- the actual PNG tiles
// still have to be downloaded fresh from Earth Engine on every year
// change, and that routinely takes longer than a fixed short delay, which
// is why a naive "wait N ms then fade" still shows a pop once the tiles
// actually land. Fixed with two overlapping raster layers instead of one:
// whichever is "front" shows the current year at full opacity, the other
// sits at opacity 0 while its tiles load, and once the hidden layer's
// tiles have actually finished loading (not just "probably by now") the
// two swap via an opacity transition (raster layers support this
// natively, so the fade itself needs no manual animation loop).
// ERA5_ANNUAL_MAX_WAIT_MS is only a safety net for the rare case the load
// event never fires cleanly (e.g. requests aborted by fast scrubbing).
const ERA5_ANNUAL_FADE_MS = 600
const ERA5_ANNUAL_MAX_WAIT_MS = 2500

function ensureEra5AnnualLayers(map, tileUrl, visible, opacity, attribution, beforeId) {
  if (map.getSource('era5-annual-0')) return // already set up
  for (const slot of [0, 1]) {
    map.addSource(`era5-annual-${slot}`, {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      attribution,
    })
    map.addLayer({
      id: `era5-annual-${slot}-layer`,
      type: 'raster',
      source: `era5-annual-${slot}`,
      layout: { visibility: visible ? 'visible' : 'none' },
      paint: {
        'raster-opacity': slot === 0 ? opacity : 0,
        'raster-opacity-transition': { duration: ERA5_ANNUAL_FADE_MS, delay: 0 },
      },
    }, beforeId)
  }
}

function crossfadeEra5Annual(map, tileUrl, opacity, activeSlotRef, fadeTimeoutRef, loadListenerRef) {
  const activeSlot = activeSlotRef.current
  const hiddenSlot = activeSlot === 0 ? 1 : 0
  const hiddenSourceId = `era5-annual-${hiddenSlot}`
  const hiddenSource = map.getSource(hiddenSourceId)
  if (!hiddenSource) return

  // Cancel any still-pending wait from a step the user has already moved
  // past (fast scrubbing), rather than letting stacked timeouts/listeners
  // fight over which layer ends up on top.
  if (fadeTimeoutRef.current) clearTimeout(fadeTimeoutRef.current)
  if (loadListenerRef.current) map.off('sourcedata', loadListenerRef.current)

  hiddenSource.setTiles([tileUrl])

  const runFade = () => {
    clearTimeout(fadeTimeoutRef.current)
    map.off('sourcedata', onSourceData)
    loadListenerRef.current = null
    map.setPaintProperty(`era5-annual-${hiddenSlot}-layer`, 'raster-opacity', opacity)
    map.setPaintProperty(`era5-annual-${activeSlot}-layer`, 'raster-opacity', 0)
    activeSlotRef.current = hiddenSlot
  }

  // Fade in only once the hidden layer's own tiles have actually finished
  // loading for the current viewport -- fading on a timer instead pops
  // once the (still downloading) tiles land underneath the fade.
  function onSourceData(e) {
    if (e.sourceId !== hiddenSourceId || !map.isSourceLoaded(hiddenSourceId)) return
    runFade()
  }
  map.on('sourcedata', onSourceData)
  loadListenerRef.current = onSourceData

  fadeTimeoutRef.current = setTimeout(runFade, ERA5_ANNUAL_MAX_WAIT_MS)
}

// Per-year prefetch, so playback/scrubbing hits the browser's own HTTP
// tile cache instead of a fresh Earth Engine round trip on every step --
// this is what actually removes the stutter, since crossfadeEra5Annual
// above can only fade in smoothly once a year's tiles exist somewhere.
// Runs on a third, permanently-invisible layer (raster-opacity 0, but
// visibility 'visible' -- Mapbox only fetches/renders a source when some
// layer actually uses it, opacity doesn't affect that) so it can warm the
// cache for every year one at a time without disturbing what's on screen.
// Only warms tiles for the current viewport -- panning/zooming afterward
// still needs fresh fetches for the new view, same as any raster layer.
const ERA5_ANNUAL_PRELOAD_TIMEOUT_MS = 4000

function ensureEra5AnnualPreloadLayer(map, firstTileUrl) {
  if (map.getSource('era5-annual-preload')) return
  map.addSource('era5-annual-preload', {
    type: 'raster',
    tiles: [firstTileUrl],
    tileSize: 256,
  })
  map.addLayer({
    id: 'era5-annual-preload-layer',
    type: 'raster',
    source: 'era5-annual-preload',
    layout: { visibility: 'visible' },
    paint: { 'raster-opacity': 0 },
  })
}

async function preloadEra5AnnualYears(map, tiles, isCancelled, isLayerWanted) {
  if (tiles.length === 0) return
  ensureEra5AnnualPreloadLayer(map, tiles[0].tileUrlTemplate)
  const source = map.getSource('era5-annual-preload')

  for (const { tileUrlTemplate } of tiles) {
    if (isCancelled() || !isLayerWanted()) return
    // eslint-disable-next-line no-await-in-loop -- deliberately sequential,
    // one year at a time, so this doesn't flood Earth Engine's tile server.
    await new Promise((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        map.off('sourcedata', onSourceData)
        clearTimeout(timeoutId)
        resolve()
      }
      function onSourceData(e) {
        if (e.sourceId === 'era5-annual-preload' && map.isSourceLoaded('era5-annual-preload')) finish()
      }
      map.on('sourcedata', onSourceData)
      const timeoutId = setTimeout(finish, ERA5_ANNUAL_PRELOAD_TIMEOUT_MS)
      source.setTiles([tileUrlTemplate])
    })
  }
}

export default function MapView({
  config,
  mapStyleId,
  era5AnnualVisible,
  era5AnnualOpacity,
  era5AnnualTileUrl,
  era5AnnualTiles,
  boundaryVisible,
  pkNationalVisible,
  pkProvincesVisible,
  pkDistrictsVisible,
  buildingsVisible,
  buildingsIndex,
  onFeatureClick,
  recenterSignal,
  flyToTarget,
  onZoomChange,
  popRasterVisible,
  popRasterOpacity,
  popRasterTileUrl,
  landcoverEsriVisible,
  landcoverEsriOpacity,
  landcoverEsriTileUrl,
  sensorsGlof2Visible,
  sensorsGlof2DamagedVisible,
  sensorsBriFfVisible,
  sensorsFocus2026Visible,
  sensorsGmrcWapdaVisible,
  riversVisible,
  hoverInfoVisible,
  hoverInfoYear,
}) {
  const pkVisible = { national: pkNationalVisible, provinces: pkProvincesVisible, districts: pkDistrictsVisible }
  const sensorsVisible = {
    glof2: sensorsGlof2Visible,
    glof2Damaged: sensorsGlof2DamagedVisible,
    briFf: sensorsBriFfVisible,
    focus2026: sensorsFocus2026Visible,
    gmrcWapda: sensorsGmrcWapdaVisible,
  }
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const isFirstStyleRef = useRef(true)
  const isFirstRecenterRef = useRef(true)
  // Ref (not a plain closure var) so the "center on HKH region" button --
  // wired up in a separate effect below -- can silence the auto-spin too.
  const spinEnabledRef = useRef(true)

  // Which of the two alternating annual-temperature layers (see
  // crossfadeEra5Annual below) is currently the visible one -- a ref, not
  // state, since flipping it shouldn't itself trigger a re-render.
  const era5AnnualActiveSlotRef = useRef(0)
  // The in-flight "wait for the hidden layer's tiles to actually finish
  // loading" timer (safety-net fallback) and the 'sourcedata' listener
  // it's racing against, so a fast scrub through years cancels the
  // previous step's wait instead of stacking them.
  const era5AnnualFadeTimeoutRef = useRef(null)
  const era5AnnualLoadListenerRef = useRef(null)

  // Temperature/elevation-on-hover toggle -- hoverInfo is the last point
  // queried (or being queried); hoverInfoTimeoutRef is the pending debounce
  // timer; hoverInfoYearRef tracks the slider's current year without
  // forcing the mousemove listener to be torn down and re-attached every
  // time the year changes (see the effect below).
  const [hoverInfo, setHoverInfo] = useState(null)
  const hoverInfoTimeoutRef = useRef(null)
  const hoverInfoYearRef = useRef(hoverInfoYear)
  hoverInfoYearRef.current = hoverInfoYear

  // Mirrored into a ref (rather than closed over) so that addOverlayLayers --
  // called fresh from 'style.load' every time the basemap switches, long
  // after the mount effect's closure was created -- always sees the current
  // toggle state instead of whatever was true when the map was first built.
  const stateRef = useRef({})
  stateRef.current = { boundaryVisible, pkVisible, era5AnnualTileUrl, era5AnnualVisible, era5AnnualOpacity, buildingsVisible, buildingsIndex, popRasterTileUrl, popRasterVisible, popRasterOpacity, landcoverEsriTileUrl, landcoverEsriVisible, landcoverEsriOpacity, sensorsVisible, riversVisible }

  // One-time map setup.
  useEffect(() => {
    if (!config) return

    const initialStyle = MAP_STYLES.find((s) => s.id === mapStyleId) || MAP_STYLES[0]
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: initialStyle.url,
      projection: 'globe',
      center: config.mapCenter,
      zoom: config.mapZoom,
      pitch: 0,
      attributionControl: true,
    })
    mapRef.current = map
    window.map = map // exposed for debugging

    // visualizePitch tilts the compass icon itself with the camera -- a
    // visual hint that dragging (right-click, or ctrl+drag) tilts the view,
    // which is how you actually see the building extrusions stand up.
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    map.addControl(new ZoomIndicatorControl(), 'bottom-right')
    map.scrollZoom.enable()

    // Reported up to the status panel so the Buildings row can show a live
    // "zoom in further" readout instead of a static, easy-to-miss hint.
    onZoomChange?.(map.getZoom())
    map.on('zoom', () => onZoomChange?.(map.getZoom()))

    // Auto-spin the globe on load -- stops for good the moment the user
    // clicks or drags, and only starts again on a page refresh.
    const secondsPerRevolution = 120
    const maxSpinZoom = 5
    const slowSpinZoom = 3

    function spinGlobe() {
      const zoom = map.getZoom()
      if (spinEnabledRef.current && zoom < maxSpinZoom) {
        let distancePerSecond = 360 / secondsPerRevolution
        if (zoom > slowSpinZoom) {
          // Ease the spin down to a stop between slowSpinZoom and maxSpinZoom.
          const zoomDif = (maxSpinZoom - zoom) / (maxSpinZoom - slowSpinZoom)
          distancePerSecond *= zoomDif
        }
        const center = map.getCenter()
        center.lng -= distancePerSecond
        map.easeTo({ center, duration: 1000, easing: (n) => n })
      }
    }

    function stopSpin() { spinEnabledRef.current = false }

    map.on('mousedown', stopSpin)
    map.on('dragstart', stopSpin)
    map.on('touchstart', stopSpin)
    map.on('wheel', stopSpin)
    map.on('moveend', () => { spinGlobe() })

    spinGlobe()

    // (Re)builds every custom source/layer on top of whatever basemap style
    // just loaded. 'style.load' fires both on initial load and again each
    // time setStyle() swaps the basemap -- and a style swap silently drops
    // any sources/layers we've added, since they aren't part of the new
    // style's own spec. Re-running this each time is what makes the glacier
    // markers, boundaries, and ERA5 overlay survive a basemap switch.
    function addOverlayLayers() {
      if (map.getSource('hkh-boundary')) return // already (re)built for this style
      const { boundaryVisible, pkVisible, era5AnnualTileUrl, era5AnnualVisible, era5AnnualOpacity, buildingsVisible, buildingsIndex, popRasterTileUrl, popRasterVisible, popRasterOpacity, landcoverEsriTileUrl, landcoverEsriVisible, landcoverEsriOpacity, sensorsVisible, riversVisible } = stateRef.current

      // HKH study area boundary (projects/endless-gamma-379613/assets/HKH) --
      // added before the glacier marker layers so it renders beneath them.
      map.addSource('hkh-boundary', {
        type: 'geojson',
        data: '/api/boundary',
      })
      map.addLayer({
        id: 'hkh-boundary-fill',
        type: 'fill',
        source: 'hkh-boundary',
        layout: { visibility: boundaryVisible ? 'visible' : 'none' },
        paint: { 'fill-color': '#ff3b30', 'fill-opacity': 0.05 },
      })
      map.addLayer({
        id: 'hkh-boundary-line',
        type: 'line',
        source: 'hkh-boundary',
        layout: { visibility: boundaryVisible ? 'visible' : 'none' },
        paint: { 'line-color': '#ff3b30', 'line-width': 2, 'line-opacity': 0.9 },
      })

      map.addSource('glaciers', {
        type: 'geojson',
        data: '/api/glaciers',
        cluster: true,
        clusterRadius: 45,
        clusterMaxZoom: 8,
        clusterProperties: {
          dec: ['+', ['case', ['==', ['get', 'trend'], -1], 1, 0]],
          inc: ['+', ['case', ['==', ['get', 'trend'], 1], 1, 0]],
        },
      })

      const decRatio = ['/', ['get', 'dec'], ['get', 'point_count']]

      // Cluster fill -- white, sized by how many glaciers it holds
      map.addLayer({
        id: 'cluster-dots',
        type: 'circle',
        source: 'glaciers',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 10, 25, 14, 100, 18, 500, 24, 2000, 32],
          'circle-color': '#ffffff',
          'circle-opacity': 0.95,
        },
      })

      // Cluster ring -- colored by the dominant trend inside the cluster, blinks like a single point
      map.addLayer({
        id: 'cluster-outline',
        type: 'circle',
        source: 'glaciers',
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 10, 25, 14, 100, 18, 500, 24, 2000, 32],
          'circle-color': '#000000',
          'circle-opacity': 0,
          'circle-stroke-color': ['step', decRatio, '#5ec8ff', 0.4, '#8ea3b6', 0.6, '#ff3b30'],
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 1,
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'glaciers',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        },
        paint: {
          'text-color': '#0b0f14',
        },
      })

      // Base dots -- individual glaciers (once a cluster breaks apart), filled by trend
      map.addLayer({
        id: 'glacier-dots',
        type: 'circle',
        source: 'glaciers',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.4, 5, 2.4, 8, 4, 12, 7],
          'circle-color': ['match', ['get', 'trend'], -1, '#ff3b30', 1, '#5ec8ff', '#ffffff'],
          'circle-opacity': 0.95,
          'circle-stroke-width': 0,
        },
      })

      // Blinking red outline -- retreating / thinning glaciers
      map.addLayer({
        id: 'glacier-outline-decreasing',
        type: 'circle',
        source: 'glaciers',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'trend'], -1]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 5, 5, 8, 8, 12, 13],
          'circle-color': '#000000',
          'circle-opacity': 0,
          'circle-stroke-color': '#ff3b30',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 1,
        },
      })

      // Blinking blue outline -- stable / gaining glaciers
      map.addLayer({
        id: 'glacier-outline-increasing',
        type: 'circle',
        source: 'glaciers',
        filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'trend'], 1]],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3, 5, 5, 8, 8, 12, 13],
          'circle-color': '#000000',
          'circle-opacity': 0,
          'circle-stroke-color': '#5ec8ff',
          'circle-stroke-width': 2,
          'circle-stroke-opacity': 1,
        },
      })

      // The annual-temperature raster + Pakistan admin boundaries both
      // render below the cluster dots, which -- having just been added
      // above -- are guaranteed to exist at this point.
      if (era5AnnualTileUrl) {
        ensureEra5AnnualLayers(map, era5AnnualTileUrl, era5AnnualVisible, era5AnnualOpacity, config.era5Annual?.attribution, 'cluster-dots')
        era5AnnualActiveSlotRef.current = 0 // fresh style load -- slot 0 is always the initial "front" layer
      }

      if (popRasterTileUrl) {
        map.addSource('population-raster', {
          type: 'raster',
          tiles: [popRasterTileUrl],
          tileSize: 256,
          attribution: config.populationRaster?.attribution,
        })
        map.addLayer({
          id: 'population-raster-layer',
          type: 'raster',
          source: 'population-raster',
          layout: { visibility: popRasterVisible ? 'visible' : 'none' },
          paint: { 'raster-opacity': popRasterOpacity },
        }, 'cluster-dots')
      }

      if (landcoverEsriTileUrl) {
        map.addSource('landcover-esri', {
          type: 'raster',
          tiles: [landcoverEsriTileUrl],
          tileSize: 256,
          attribution: config.landcoverEsri?.attribution,
        })
        map.addLayer({
          id: 'landcover-esri-layer',
          type: 'raster',
          source: 'landcover-esri',
          layout: { visibility: landcoverEsriVisible ? 'visible' : 'none' },
          paint: { 'raster-opacity': landcoverEsriOpacity },
        }, 'cluster-dots')
      }


      PK_LEVELS.forEach(({ key, url, color, lineWidth, fillOpacity }) => {
        if (!pkVisible[key]) return // not toggled on -- don't fetch until asked
        map.addSource(`pk-${key}`, { type: 'geojson', data: url })
        map.addLayer({
          id: `pk-${key}-fill`,
          type: 'fill',
          source: `pk-${key}`,
          paint: { 'fill-color': color, 'fill-opacity': fillOpacity },
        }, 'cluster-dots')
        map.addLayer({
          id: `pk-${key}-line`,
          type: 'line',
          source: `pk-${key}`,
          paint: { 'line-color': color, 'line-width': lineWidth, 'line-opacity': 0.85 },
        }, 'cluster-dots')
      })

      if (buildingsVisible && buildingsIndex) {
        buildingsIndex.districts.forEach(({ id, bounds }) => {
          addBuildingLayer(map, buildingsIndex.tileServer, id, bounds, 'cluster-dots')
        })
      }

      SENSOR_LAYERS.forEach((layer) => {
        if (!sensorsVisible[layer.key]) return // not toggled on -- don't fetch until asked
        addSensorLayer(map, layer, 'cluster-dots')
      })

      if (riversVisible) addRiversLayer(map, 'cluster-dots') // else: not toggled on, don't fetch until asked
    }

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(20, 27, 34)',
        'high-color': 'rgb(36, 52, 68)',
        'horizon-blend': 0.03,
        'space-color': 'rgb(5, 8, 12)',
        'star-intensity': 0.4,
      })
      addOverlayLayers()
    })

    let rafId
    map.on('load', () => {
      // Cheap global blink loop -- animates layer-wide paint props, not
      // per-feature. Layer ids are recreated with the same names on every
      // basemap switch, so this loop (started once) keeps working across
      // switches; the existence check just guards the instant a switch is
      // still swapping styles.
      let t0 = performance.now()
      function blink(now) {
        if (map.getLayer('glacier-outline-decreasing')) {
          const dt = (now - t0) / 1000
          const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(dt * 2.4)) // 0.35 - 1.0
          const widthPulse = 1.4 + 1.8 * (0.5 + 0.5 * Math.sin(dt * 2.4)) // 1.4 - 3.2
          map.setPaintProperty('glacier-outline-decreasing', 'circle-stroke-opacity', pulse)
          map.setPaintProperty('glacier-outline-decreasing', 'circle-stroke-width', widthPulse)
          map.setPaintProperty('glacier-outline-increasing', 'circle-stroke-opacity', pulse)
          map.setPaintProperty('glacier-outline-increasing', 'circle-stroke-width', widthPulse)
          map.setPaintProperty('cluster-outline', 'circle-stroke-opacity', pulse)
          map.setPaintProperty('cluster-outline', 'circle-stroke-width', widthPulse)
        }
        rafId = requestAnimationFrame(blink)
      }
      rafId = requestAnimationFrame(blink)

      // Cursor affordance
      ;['glacier-dots', 'cluster-dots'].forEach((layer) => {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      })

      // Clicking a cluster zooms in until it breaks apart
      map.on('click', 'cluster-dots', (e) => {
        const f = e.features[0]
        const clusterId = f.properties.cluster_id
        map.getSource('glaciers').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return
          map.easeTo({ center: f.geometry.coordinates, zoom })
        })
      })

      // Clicking an individual glacier opens the data sheet
      map.on('click', 'glacier-dots', (e) => {
        onFeatureClick(e.features[0])
      })
    })

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  // Swap the basemap when the user picks a different style. The very first
  // run is a no-op -- that initial style is already set at map creation
  // above -- everything after that calls setStyle(), which triggers
  // 'style.load' and, via addOverlayLayers(), rebuilds the glacier/boundary/
  // ERA5 layers on top of the new basemap.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (isFirstStyleRef.current) {
      isFirstStyleRef.current = false
      return
    }
    const style = MAP_STYLES.find((s) => s.id === mapStyleId)
    if (style) map.setStyle(style.url)
  }, [mapStyleId])

  // "Center on HKH region" button (in the status panel) bumps this counter.
  // The first run is a no-op -- the map already opens on the HKH region --
  // every increment after that flies/fits back to it and cancels the
  // auto-spin, so a deliberate recenter doesn't get immediately undone.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (isFirstRecenterRef.current) {
      isFirstRecenterRef.current = false
      return
    }
    spinEnabledRef.current = false
    if (config?.hkhBounds) {
      map.fitBounds(config.hkhBounds, { padding: 60, duration: 1500 })
    } else {
      map.flyTo({ center: config.mapCenter, zoom: config.mapZoom, duration: 1500 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterSignal])

  // Chatbot "fly to" (a place, or a glacier it just opened). `seq` changes
  // on every request, so flying to the same spot twice still re-triggers.
  // Same auto-spin cancel as the recenter above.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !flyToTarget) return
    spinEnabledRef.current = false
    map.flyTo({ center: [flyToTarget.lon, flyToTarget.lat], zoom: flyToTarget.zoom ?? 8, duration: 2000 })
  }, [flyToTarget])

  // Add the two-layer setup on first use, or cross-fade to the newly
  // selected year's tile once it's already in place -- see
  // ensureEra5AnnualLayers/crossfadeEra5Annual above for why it's two
  // layers instead of one.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !era5AnnualTileUrl) return

    const apply = () => {
      if (map.getSource('era5-annual-0')) {
        crossfadeEra5Annual(map, era5AnnualTileUrl, era5AnnualOpacity, era5AnnualActiveSlotRef, era5AnnualFadeTimeoutRef, era5AnnualLoadListenerRef)
        return
      }
      const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
      ensureEra5AnnualLayers(map, era5AnnualTileUrl, era5AnnualVisible, era5AnnualOpacity, config.era5Annual?.attribution, beforeId)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [era5AnnualTileUrl])

  // Background-prefetch every year's tiles as soon as the full batch is
  // known, so by the time the user actually plays or scrubs, most years
  // are already sitting in the browser's HTTP cache -- see
  // preloadEra5AnnualYears above for why this is what actually fixes the
  // stutter (crossfadeEra5Annual can only fade smoothly into tiles that
  // already exist somewhere). Bails early, mid-loop, if the layer gets
  // toggled off, and only warms tiles for the viewport at the time it
  // runs -- panning/zooming after still needs fresh fetches.
  useEffect(() => {
    const map = mapRef.current
    const tiles = Object.values(era5AnnualTiles || {}).sort((a, b) => a.year - b.year)
    if (!map || tiles.length === 0) return

    let cancelled = false
    const apply = () => {
      preloadEra5AnnualYears(map, tiles, () => cancelled, () => stateRef.current.era5AnnualVisible)
    }
    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [era5AnnualTiles])

  // Cancel any pending cross-fade (timer and listener) on unmount so
  // neither can fire after the map/layers are gone.
  useEffect(() => {
    return () => {
      if (era5AnnualFadeTimeoutRef.current) clearTimeout(era5AnnualFadeTimeoutRef.current)
      const map = mapRef.current
      if (map && era5AnnualLoadListenerRef.current) map.off('sourcedata', era5AnnualLoadListenerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync annual-temperature layer visibility with the toggle -- both
  // layers together, regardless of which is currently the cross-fade's
  // "front" one.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('era5-annual-0-layer')) return
    const visibility = era5AnnualVisible ? 'visible' : 'none'
    map.setLayoutProperty('era5-annual-0-layer', 'visibility', visibility)
    map.setLayoutProperty('era5-annual-1-layer', 'visibility', visibility)
  }, [era5AnnualVisible])

  // Sync annual-temperature layer opacity with the slider -- only the
  // active (front) layer's target opacity; the hidden one stays at 0
  // until the next cross-fade.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('era5-annual-0-layer')) return
    map.setPaintProperty(`era5-annual-${era5AnnualActiveSlotRef.current}-layer`, 'raster-opacity', era5AnnualOpacity)
  }, [era5AnnualOpacity])

  // Add the population-density raster once its tile URL resolves (a single
  // fetch, unlike ERA5's per-month tile -- see App.jsx) -- same pattern as
  // ERA5 above otherwise.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !popRasterTileUrl) return

    const apply = () => {
      const source = map.getSource('population-raster')
      if (source) {
        source.setTiles([popRasterTileUrl])
        return
      }
      map.addSource('population-raster', {
        type: 'raster',
        tiles: [popRasterTileUrl],
        tileSize: 256,
        attribution: config.populationRaster?.attribution,
      })
      const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
      map.addLayer({
        id: 'population-raster-layer',
        type: 'raster',
        source: 'population-raster',
        layout: { visibility: popRasterVisible ? 'visible' : 'none' },
        paint: { 'raster-opacity': popRasterOpacity },
      }, beforeId)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popRasterTileUrl])

  // Sync population-raster layer visibility with the toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('population-raster-layer')) return
    map.setLayoutProperty('population-raster-layer', 'visibility', popRasterVisible ? 'visible' : 'none')
  }, [popRasterVisible])

  // Sync population-raster layer opacity with the slider.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('population-raster-layer')) return
    map.setPaintProperty('population-raster-layer', 'raster-opacity', popRasterOpacity)
  }, [popRasterOpacity])

  // Add the land-cover raster once its tile URL resolves -- same pattern
  // as population-density above (a single tile per toggle-on, not a
  // per-frame slider like the annual-temperature layer).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !landcoverEsriTileUrl) return

    const apply = () => {
      const source = map.getSource('landcover-esri')
      if (source) {
        source.setTiles([landcoverEsriTileUrl])
        return
      }
      map.addSource('landcover-esri', {
        type: 'raster',
        tiles: [landcoverEsriTileUrl],
        tileSize: 256,
        attribution: config.landcoverEsri?.attribution,
      })
      const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
      map.addLayer({
        id: 'landcover-esri-layer',
        type: 'raster',
        source: 'landcover-esri',
        layout: { visibility: landcoverEsriVisible ? 'visible' : 'none' },
        paint: { 'raster-opacity': landcoverEsriOpacity },
      }, beforeId)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landcoverEsriTileUrl])

  // Sync land-cover layer visibility with the toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('landcover-esri-layer')) return
    map.setLayoutProperty('landcover-esri-layer', 'visibility', landcoverEsriVisible ? 'visible' : 'none')
  }, [landcoverEsriVisible])

  // Sync land-cover layer opacity with the slider.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('landcover-esri-layer')) return
    map.setPaintProperty('landcover-esri-layer', 'raster-opacity', landcoverEsriOpacity)
  }, [landcoverEsriOpacity])

  // Sync study area boundary visibility with its toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('hkh-boundary-line')) return
    const visibility = boundaryVisible ? 'visible' : 'none'
    map.setLayoutProperty('hkh-boundary-fill', 'visibility', visibility)
    map.setLayoutProperty('hkh-boundary-line', 'visibility', visibility)
  }, [boundaryVisible])

  // Pakistan admin boundaries (national / provinces / districts) -- each
  // source+layer pair is created the first time its toggle is switched on
  // (so the heavier districts file isn't fetched until asked for), and
  // just has its visibility flipped after that.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    PK_LEVELS.forEach(({ key, url, color, lineWidth, fillOpacity }) => {
      const visible = pkVisible[key]
      const fillId = `pk-${key}-fill`
      const lineId = `pk-${key}-line`

      const apply = () => {
        if (map.getLayer(lineId)) {
          const visibility = visible ? 'visible' : 'none'
          map.setLayoutProperty(fillId, 'visibility', visibility)
          map.setLayoutProperty(lineId, 'visibility', visibility)
          return
        }
        if (!visible) return // nothing to hide -- don't fetch until asked

        map.addSource(`pk-${key}`, { type: 'geojson', data: url })
        const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
        map.addLayer({
          id: fillId,
          type: 'fill',
          source: `pk-${key}`,
          paint: { 'fill-color': color, 'fill-opacity': fillOpacity },
        }, beforeId)
        map.addLayer({
          id: lineId,
          type: 'line',
          source: `pk-${key}`,
          paint: { 'line-color': color, 'line-width': lineWidth, 'line-opacity': 0.85 },
        }, beforeId)
      }

      if (map.isStyleLoaded()) {
        apply()
      } else {
        map.once('load', apply)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkNationalVisible, pkProvincesVisible, pkDistrictsVisible])

  // Rivers / canals / nallas -- same lazy, "don't fetch until asked"
  // pattern as the Pakistan boundaries above (source file is ~9MB).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      if (map.getLayer('rivers-line')) {
        const visibility = riversVisible ? 'visible' : 'none'
        map.setLayoutProperty('rivers-fill', 'visibility', visibility)
        map.setLayoutProperty('rivers-line', 'visibility', visibility)
        return
      }
      if (!riversVisible) return // nothing to hide -- don't fetch until asked
      addRiversLayer(map, map.getLayer('cluster-dots') ? 'cluster-dots' : undefined)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [riversVisible])

  // Building footprints -- same lazy, "don't fetch until asked" pattern as
  // the Pakistan boundaries above: the ~160 district sources are only
  // created the first time this toggle is switched on, and just have their
  // visibility flipped after that.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !buildingsIndex) return

    const apply = () => {
      const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
      buildingsIndex.districts.forEach(({ id, bounds }) => {
        const layerId = `bld-${id}`
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', buildingsVisible ? 'visible' : 'none')
          return
        }
        if (!buildingsVisible) return // nothing to hide -- don't add until asked
        addBuildingLayer(map, buildingsIndex.tileServer, id, bounds, beforeId)
      })
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
  }, [buildingsVisible, buildingsIndex])

  // Sensor / monitoring-station networks -- same lazy toggle pattern as the
  // Pakistan boundaries and buildings above: each source+layer is created
  // the first time its toggle is switched on, and just has its visibility
  // flipped after that.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    SENSOR_LAYERS.forEach((layer) => {
      const visible = sensorsVisible[layer.key]
      const layerId = `sensor-${layer.key}`

      const apply = () => {
        if (map.getLayer(layerId)) {
          const visibility = visible ? 'visible' : 'none'
          map.setLayoutProperty(layerId, 'visibility', visibility)
          map.setLayoutProperty(`${layerId}-center`, 'visibility', visibility)
          return
        }
        if (!visible) return // nothing to hide -- don't fetch until asked
        const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
        addSensorLayer(map, layer, beforeId)
      }

      if (map.isStyleLoaded()) {
        apply()
      } else {
        map.once('load', apply)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sensorsGlof2Visible, sensorsGlof2DamagedVisible, sensorsBriFfVisible, sensorsFocus2026Visible, sensorsGmrcWapdaVisible])

  // Temperature/elevation-on-hover toggle -- debounced so moving the
  // cursor doesn't fire a live Earth Engine round trip on every mousemove
  // event (see /api/hover-info; each one is ~200ms-2s the first time a
  // given ~10km temperature cell or ~30m elevation pixel is queried, near-
  // instant on repeat since the backend caches by snapped coordinates).
  // Re-runs only when the toggle itself flips, not when the slider's year
  // changes -- hoverInfoYearRef carries the latest year into the listener
  // without needing to tear it down and re-attach every slider step.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!hoverInfoVisible) {
      setHoverInfo(null)
      if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current)
      return
    }

    const HOVER_DEBOUNCE_MS = 220

    function onMouseMove(e) {
      const { lng, lat } = e.lngLat
      setHoverInfo((prev) => ({ lon: lng, lat, tempC: prev?.tempC ?? null, elevationM: prev?.elevationM ?? null, loading: true }))
      if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current)
      hoverInfoTimeoutRef.current = setTimeout(() => {
        const year = hoverInfoYearRef.current
        if (year == null) return
        fetch(`/api/hover-info?lon=${lng}&lat=${lat}&year=${year}`)
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`request failed (${r.status})`))))
          .then((data) => setHoverInfo({ lon: lng, lat, tempC: data.tempC, elevationM: data.elevationM, loading: false }))
          .catch(() => setHoverInfo((prev) => (prev ? { ...prev, loading: false } : null)))
      }, HOVER_DEBOUNCE_MS)
    }

    function onMouseLeave() {
      if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current)
      setHoverInfo(null)
    }

    map.on('mousemove', onMouseMove)
    map.on('mouseout', onMouseLeave)
    return () => {
      map.off('mousemove', onMouseMove)
      map.off('mouseout', onMouseLeave)
      if (hoverInfoTimeoutRef.current) clearTimeout(hoverInfoTimeoutRef.current)
    }
  }, [hoverInfoVisible])

  return (
    <>
      <div id="map" ref={containerRef} />
      {hoverInfoVisible && hoverInfo && (
        <div id="hover-info-readout">
          <div className="hover-info-coord">{hoverInfo.lat.toFixed(4)}°, {hoverInfo.lon.toFixed(4)}°</div>
          <div className="hover-info-row">
            <span className="k">Temp</span>
            <span className="v">
              {hoverInfo.tempC != null ? `${hoverInfo.tempC.toFixed(1)}°C` : hoverInfo.loading ? '…' : '—'}
            </span>
          </div>
          <div className="hover-info-row">
            <span className="k">Elev</span>
            <span className="v">
              {hoverInfo.elevationM != null ? `${Math.round(hoverInfo.elevationM)} m` : hoverInfo.loading ? '…' : '—'}
            </span>
          </div>
        </div>
      )}
    </>
  )
}
