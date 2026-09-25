import { useEffect, useRef } from 'react'
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

export default function MapView({
  config,
  mapStyleId,
  era5Visible,
  era5Opacity,
  era5TileUrl,
  boundaryVisible,
  pkNationalVisible,
  pkProvincesVisible,
  pkDistrictsVisible,
  buildingsVisible,
  buildingsIndex,
  onFeatureClick,
  recenterSignal,
  onZoomChange,
  popRasterVisible,
  popRasterOpacity,
  popRasterTileUrl,
  sensorsGlof2Visible,
  sensorsGlof2DamagedVisible,
  sensorsBriFfVisible,
  sensorsFocus2026Visible,
  sensorsGmrcWapdaVisible,
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

  // Mirrored into a ref (rather than closed over) so that addOverlayLayers --
  // called fresh from 'style.load' every time the basemap switches, long
  // after the mount effect's closure was created -- always sees the current
  // toggle state instead of whatever was true when the map was first built.
  const stateRef = useRef({})
  stateRef.current = { boundaryVisible, pkVisible, era5TileUrl, era5Visible, era5Opacity, buildingsVisible, buildingsIndex, popRasterTileUrl, popRasterVisible, popRasterOpacity, sensorsVisible }

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
      const { boundaryVisible, pkVisible, era5TileUrl, era5Visible, era5Opacity, buildingsVisible, buildingsIndex, popRasterTileUrl, popRasterVisible, popRasterOpacity, sensorsVisible } = stateRef.current

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
        paint: { 'fill-color': '#ffcc00', 'fill-opacity': 0.03 },
      })
      map.addLayer({
        id: 'hkh-boundary-line',
        type: 'line',
        source: 'hkh-boundary',
        layout: { visibility: boundaryVisible ? 'visible' : 'none' },
        paint: { 'line-color': '#ffcc00', 'line-width': 2, 'line-opacity': 0.85 },
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

      // ERA5 raster + Pakistan admin boundaries both render below the
      // cluster dots, which -- having just been added above -- are
      // guaranteed to exist at this point.
      if (era5TileUrl) {
        map.addSource('era5-temp', {
          type: 'raster',
          tiles: [era5TileUrl],
          tileSize: 256,
          attribution: config.era5?.attribution,
        })
        map.addLayer({
          id: 'era5-temp-layer',
          type: 'raster',
          source: 'era5-temp',
          layout: { visibility: era5Visible ? 'visible' : 'none' },
          paint: { 'raster-opacity': era5Opacity },
        }, 'cluster-dots')
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

  // Add (or swap the tile URL of) the ERA5 raster layer whenever the
  // selected month resolves to a fresh tile. Placed below the glacier
  // marker layers so pins stay on top.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !era5TileUrl) return

    const apply = () => {
      const source = map.getSource('era5-temp')
      if (source) {
        source.setTiles([era5TileUrl])
        return
      }
      map.addSource('era5-temp', {
        type: 'raster',
        tiles: [era5TileUrl],
        tileSize: 256,
        attribution: config.era5.attribution,
      })
      const beforeId = map.getLayer('cluster-dots') ? 'cluster-dots' : undefined
      map.addLayer({
        id: 'era5-temp-layer',
        type: 'raster',
        source: 'era5-temp',
        layout: { visibility: era5Visible ? 'visible' : 'none' },
        paint: { 'raster-opacity': era5Opacity },
      }, beforeId)
    }

    if (map.isStyleLoaded()) {
      apply()
    } else {
      map.once('load', apply)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [era5TileUrl])

  // Sync ERA5 layer visibility with the toggle.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('era5-temp-layer')) return
    map.setLayoutProperty('era5-temp-layer', 'visibility', era5Visible ? 'visible' : 'none')
  }, [era5Visible])

  // Sync ERA5 layer opacity with the slider.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.getLayer('era5-temp-layer')) return
    map.setPaintProperty('era5-temp-layer', 'raster-opacity', era5Opacity)
  }, [era5Opacity])

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

  return <div id="map" ref={containerRef} />
}
