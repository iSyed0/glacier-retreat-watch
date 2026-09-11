import { useEffect, useRef } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN

// Pakistan admin boundaries (D:\boundries) -- each is added to the map lazily,
// the first time its toggle is switched on, so the ~6MB districts layer in
// particular isn't fetched unless someone actually asks to see it.
const PK_LEVELS = [
  { key: 'national', url: '/api/boundaries/pakistan/national', color: '#ff8a00', lineWidth: 2, fillOpacity: 0.02 },
  { key: 'provinces', url: '/api/boundaries/pakistan/provinces', color: '#c264ff', lineWidth: 1.5, fillOpacity: 0.02 },
  { key: 'districts', url: '/api/boundaries/pakistan/districts', color: '#8ea3b6', lineWidth: 0.75, fillOpacity: 0 },
]

export default function MapView({
  config,
  era5Visible,
  era5Opacity,
  era5TileUrl,
  boundaryVisible,
  pkNationalVisible,
  pkProvincesVisible,
  pkDistrictsVisible,
  onFeatureClick,
}) {
  const pkVisible = { national: pkNationalVisible, provinces: pkProvincesVisible, districts: pkDistrictsVisible }
  const containerRef = useRef(null)
  const mapRef = useRef(null)

  // One-time map setup.
  useEffect(() => {
    if (!config) return

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      projection: 'globe',
      center: config.mapCenter,
      zoom: config.mapZoom,
      pitch: 0,
      attributionControl: true,
    })
    mapRef.current = map
    window.map = map // exposed for debugging

    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right')
    map.scrollZoom.enable()

    // Auto-spin the globe on load -- stops for good the moment the user
    // clicks or drags, and only starts again on a page refresh.
    const secondsPerRevolution = 120
    const maxSpinZoom = 5
    const slowSpinZoom = 3
    let spinEnabled = true

    function spinGlobe() {
      const zoom = map.getZoom()
      if (spinEnabled && zoom < maxSpinZoom) {
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

    function stopSpin() { spinEnabled = false }

    map.on('mousedown', stopSpin)
    map.on('dragstart', stopSpin)
    map.on('touchstart', stopSpin)
    map.on('wheel', stopSpin)
    map.on('moveend', () => { spinGlobe() })

    spinGlobe()

    map.on('style.load', () => {
      map.setFog({
        color: 'rgb(20, 27, 34)',
        'high-color': 'rgb(36, 52, 68)',
        'horizon-blend': 0.03,
        'space-color': 'rgb(5, 8, 12)',
        'star-intensity': 0.4,
      })
    })

    let rafId
    map.on('load', () => {
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

      // Cheap global blink loop -- animates layer-wide paint props, not per-feature
      let t0 = performance.now()
      function blink(now) {
        const dt = (now - t0) / 1000
        const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(dt * 2.4)) // 0.35 - 1.0
        const widthPulse = 1.4 + 1.8 * (0.5 + 0.5 * Math.sin(dt * 2.4)) // 1.4 - 3.2
        map.setPaintProperty('glacier-outline-decreasing', 'circle-stroke-opacity', pulse)
        map.setPaintProperty('glacier-outline-decreasing', 'circle-stroke-width', widthPulse)
        map.setPaintProperty('glacier-outline-increasing', 'circle-stroke-opacity', pulse)
        map.setPaintProperty('glacier-outline-increasing', 'circle-stroke-width', widthPulse)
        map.setPaintProperty('cluster-outline', 'circle-stroke-opacity', pulse)
        map.setPaintProperty('cluster-outline', 'circle-stroke-width', widthPulse)
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

  return <div id="map" ref={containerRef} />
}
