import { useEffect, useState } from 'react'
import './App.css'
import MapView from './components/MapView'
import Legend from './components/Legend'
import AnnualTimeSlider from './components/AnnualTimeSlider'
import DataSheet, { toTerrainFeature } from './components/DataSheet'
import TerrainView from './components/TerrainView'
import BasemapSwitcher from './components/BasemapSwitcher'
import TrendsPanelStats from './components/TrendsPanelStats'
import ChartsPanel from './components/ChartsPanel'
import { DEFAULT_MAP_STYLE_ID } from './mapStyles'
import ChatPanel from './chat/ChatPanel'
import { applyChatActions, buildUiState, openGlacier } from './chat/actions'

// One entry per chart the floating Charts panel can open -- add a chart by
// adding a row here; ChartsPanel's list and the modals below are both
// driven off this array plus the single `charts` state map (see openChart).
const CHART_DEFS = [
  {
    key: 'trendsHkh',
    endpoint: '/api/trends',
    variant: 'elevation',
    rowTitle: 'Elevation change + temperature',
    region: 'HKH region',
    title: 'Glacier change vs. temperature',
    sub: 'HKH region · 1999–2019 measured, 2020–2026 WGMS AMCE update',
    scopeNote: 'every HKH glacier',
  },
  {
    key: 'trendsPk',
    endpoint: '/api/trends/pk',
    variant: 'elevation',
    rowTitle: 'Elevation change + temperature',
    region: 'Pakistan',
    title: 'Glacier change vs. temperature — Pakistan',
    sub: 'Pakistan (HKH) · 1999–2019 measured, 2020–2026 WGMS AMCE update',
    scopeNote: 'every glacier inside Pakistan',
  },
  {
    key: 'specificMassHkh',
    endpoint: '/api/trends',
    variant: 'specificMass',
    rowTitle: 'Specific mass balance + temperature',
    region: 'HKH region',
    title: 'Glacier specific mass balance vs. temperature',
    sub: 'HKH region · 1999–2019 measured, 2020–2026 WGMS AMCE update',
    scopeNote: 'every HKH glacier',
  },
  {
    key: 'specificMassPk',
    endpoint: '/api/trends/pk',
    variant: 'specificMass',
    rowTitle: 'Specific mass balance + temperature',
    region: 'Pakistan',
    title: 'Glacier specific mass balance vs. temperature — Pakistan',
    sub: 'Pakistan (HKH) · 1999–2019 measured, 2020–2026 WGMS AMCE update',
    scopeNote: 'every glacier inside Pakistan',
  },
]

export default function App() {
  const [config, setConfig] = useState(null)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [terrainViewFeature, setTerrainViewFeature] = useState(null)
  const [logoError, setLogoError] = useState(false)
  const [mapStyleId, setMapStyleId] = useState(DEFAULT_MAP_STYLE_ID)
  const [recenterSignal, setRecenterSignal] = useState(0)
  const [flyToTarget, setFlyToTarget] = useState(null) // { lon, lat, zoom, seq } -- set by the chatbot

  const [era5AnnualVisible, setEra5AnnualVisible] = useState(false)
  const [era5AnnualOpacity, setEra5AnnualOpacity] = useState(0.65)
  const [era5AnnualRange, setEra5AnnualRange] = useState(null) // { min: 1999, max: 2026 }
  const [era5AnnualYear, setEra5AnnualYear] = useState(null) // the year the user has selected
  const [era5AnnualTiles, setEra5AnnualTiles] = useState({}) // year -> { tileUrlTemplate, year, meanTempC }, all fetched in one batch
  const [era5AnnualStatus, setEra5AnnualStatus] = useState('idle') // idle | loading | ready | error -- for the one-time batch fetch, not per-year
  const [era5AnnualError, setEra5AnnualError] = useState('')
  const [era5AnnualPlaying, setEra5AnnualPlaying] = useState(false)
  const [boundaryVisible, setBoundaryVisible] = useState(true)
  const [pkNationalVisible, setPkNationalVisible] = useState(false)
  const [pkProvincesVisible, setPkProvincesVisible] = useState(false)
  const [pkDistrictsVisible, setPkDistrictsVisible] = useState(false)
  const [buildingsVisible, setBuildingsVisible] = useState(false)
  const [buildingsIndex, setBuildingsIndex] = useState(null) // { tileServer, districts: [{id, bounds}] }
  const [buildingsStatus, setBuildingsStatus] = useState('loading') // loading | ready | error
  const [buildingsError, setBuildingsError] = useState('')
  const [mapZoom, setMapZoom] = useState(null)
  const [popRasterVisible, setPopRasterVisible] = useState(false)
  const [popRasterOpacity, setPopRasterOpacity] = useState(0.65)
  const [popRasterTile, setPopRasterTile] = useState(null) // { tileUrlTemplate }
  const [popRasterStatus, setPopRasterStatus] = useState('loading') // loading | ready | error
  const [popRasterError, setPopRasterError] = useState('')
  const [sensorsGlof2Visible, setSensorsGlof2Visible] = useState(false)
  const [sensorsGlof2DamagedVisible, setSensorsGlof2DamagedVisible] = useState(false)
  const [sensorsBriFfVisible, setSensorsBriFfVisible] = useState(false)
  const [sensorsFocus2026Visible, setSensorsFocus2026Visible] = useState(false)
  const [sensorsGmrcWapdaVisible, setSensorsGmrcWapdaVisible] = useState(false)
  const [riversVisible, setRiversVisible] = useState(false)
  const [hoverInfoVisible, setHoverInfoVisible] = useState(false)
  const [landcoverEsriVisible, setLandcoverEsriVisible] = useState(false)
  const [landcoverEsriOpacity, setLandcoverEsriOpacity] = useState(0.7)
  const [landcoverEsriTile, setLandcoverEsriTile] = useState(null) // { tileUrlTemplate, year }
  const [landcoverEsriStatus, setLandcoverEsriStatus] = useState('idle') // idle | loading | ready | error
  const [landcoverEsriError, setLandcoverEsriError] = useState('')
  const [charts, setCharts] = useState(() =>
    Object.fromEntries(CHART_DEFS.map((d) => [d.key, { open: false, data: null, status: 'idle', error: '' }]))
  )

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch((err) => console.error('Failed to load config:', err))
  }, [])

  // District id + bounds for every building-footprint tileset -- the actual
  // vector sources are only added to the map once this layer is switched on
  // (see MapView), but the lightweight index is worth fetching up front.
  useEffect(() => {
    fetch('/api/buildings/index')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((data) => {
        setBuildingsIndex(data)
        setBuildingsStatus('ready')
      })
      .catch((err) => {
        setBuildingsStatus('error')
        setBuildingsError(err.message)
      })
  }, [])

  // Population density raster (CIESIN GPWv4.11 via Earth Engine) -- unlike
  // ERA5 there's no month parameter (it's a single 2020 snapshot), so this
  // is a one-shot fetch rather than something re-triggered by a selection.
  useEffect(() => {
    fetch('/api/population/raster')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((tile) => {
        setPopRasterTile(tile)
        setPopRasterStatus('ready')
      })
      .catch((err) => {
        setPopRasterStatus('error')
        setPopRasterError(err.message)
      })
  }, [])

  // Find out which years the annual layer covers, then default to the
  // earliest (matching the GEE script this layer was ported from, which
  // opens on 1999 rather than the most recent year).
  useEffect(() => {
    fetch('/api/era5-annual/range')
      .then((r) => {
        if (!r.ok) throw new Error(`range request failed (${r.status})`)
        return r.json()
      })
      .then((range) => {
        setEra5AnnualRange(range)
        setEra5AnnualYear(range.min)
      })
      .catch((err) => setEra5AnnualError(err.message))
  }, [])

  // Fetch every year's tile in one batch, the first time the layer is
  // switched on -- not one request per year as the slider moves. Each
  // year is a real Earth Engine round trip, so per-year fetching was slow
  // enough that scrubbing/playing visibly lagged, and a fetch for a year
  // the user had already moved past could still resolve and briefly show
  // stale imagery. era5AnnualStatus stays 'idle' until this fires, so the
  // guard below only lets it run once.
  useEffect(() => {
    if (!era5AnnualVisible || era5AnnualStatus !== 'idle') return
    setEra5AnnualStatus('loading')
    fetch('/api/era5-annual/tiles')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((tiles) => {
        setEra5AnnualTiles(Object.fromEntries(tiles.map((t) => [t.year, t])))
        setEra5AnnualStatus('ready')
      })
      .catch((err) => {
        setEra5AnnualStatus('error')
        setEra5AnnualError(err.message)
      })
  }, [era5AnnualVisible, era5AnnualStatus])

  // Play/pause: advance one year at a time on a fixed interval (matching
  // the 1200ms cadence of the GEE script this was ported from), looping
  // back to the first year at the end rather than stopping -- playback
  // only stops when paused manually. Gated on the batch fetch above being
  // done -- every year is instant once it is, so there's no per-frame
  // loading state to juggle during playback.
  useEffect(() => {
    if (!era5AnnualPlaying || !era5AnnualRange || era5AnnualStatus !== 'ready') return
    const id = setInterval(() => {
      setEra5AnnualYear((y) => (y >= era5AnnualRange.max ? era5AnnualRange.min : y + 1))
    }, 1200)
    return () => clearInterval(id)
  }, [era5AnnualPlaying, era5AnnualRange, era5AnnualStatus])

  // Land cover -- fetch the current year's tile the first time the layer
  // is switched on (same "don't fetch until asked" pattern as rivers/PK
  // districts), not on mount.
  useEffect(() => {
    if (!landcoverEsriVisible || landcoverEsriStatus !== 'idle') return
    setLandcoverEsriStatus('loading')
    fetch('/api/landcover-esri/tile')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((tile) => {
        setLandcoverEsriTile(tile)
        setLandcoverEsriStatus('ready')
      })
      .catch((err) => {
        setLandcoverEsriStatus('error')
        setLandcoverEsriError(err.message)
      })
  }, [landcoverEsriVisible, landcoverEsriStatus])

  // Fetch a chart's data the first time it's opened, not on mount -- these
  // are real Earth Engine + local-computation calls on the backend, worth
  // deferring until someone actually asks to see them. Each of the four
  // charts (see CHART_DEFS) is its own backend endpoint, fetched once and
  // cached in `charts[key]` for the life of the page.
  const openChart = (key) => {
    setCharts((prev) => ({ ...prev, [key]: { ...prev[key], open: true } }))
    if (charts[key].status !== 'idle') return
    const def = CHART_DEFS.find((d) => d.key === key)
    setCharts((prev) => ({ ...prev, [key]: { ...prev[key], status: 'loading' } }))
    fetch(def.endpoint)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((data) => {
        setCharts((prev) => ({ ...prev, [key]: { ...prev[key], data, status: 'ready' } }))
      })
      .catch((err) => {
        setCharts((prev) => ({ ...prev, [key]: { ...prev[key], status: 'error', error: err.message } }))
      })
  }

  const closeChart = (key) => setCharts((prev) => ({ ...prev, [key]: { ...prev[key], open: false } }))

  // The current year's entry out of the batch fetched above -- looked up,
  // not fetched, so selecting/scrubbing/playing a year is instant.
  const era5AnnualTile = era5AnnualYear != null ? era5AnnualTiles[era5AnnualYear] || null : null

  // Chatbot -> portal. Keys match CHAT_LAYERS in chat/actions.js; these
  // are the same setters the Legend's toggles call, so a chatbot action is
  // indistinguishable from the user clicking.
  const layerSetters = {
    boundary: setBoundaryVisible,
    pkNational: setPkNationalVisible,
    pkProvinces: setPkProvincesVisible,
    pkDistricts: setPkDistrictsVisible,
    buildings: setBuildingsVisible,
    popRaster: setPopRasterVisible,
    landcoverEsri: setLandcoverEsriVisible,
    era5Annual: setEra5AnnualVisible,
    rivers: setRiversVisible,
    hoverInfo: setHoverInfoVisible,
    sensorsGlof2: setSensorsGlof2Visible,
    sensorsGlof2Damaged: setSensorsGlof2DamagedVisible,
    sensorsBriFf: setSensorsBriFfVisible,
    sensorsFocus2026: setSensorsFocus2026Visible,
    sensorsGmrcWapda: setSensorsGmrcWapdaVisible,
  }
  const opacitySetters = {
    era5Annual: setEra5AnnualOpacity,
    popRaster: setPopRasterOpacity,
    landcoverEsri: setLandcoverEsriOpacity,
  }
  const chatHandlers = {
    setLayer: (key, on) => layerSetters[key]?.(on),
    setOpacity: (key, value) => opacitySetters[key]?.(value),
    setBasemap: setMapStyleId,
    setYear: (year) => setEra5AnnualYear(
      era5AnnualRange ? Math.min(era5AnnualRange.max, Math.max(era5AnnualRange.min, year)) : year
    ),
    setPlaying: setEra5AnnualPlaying,
    flyTo: (target) => setFlyToTarget((prev) => ({ ...target, seq: (prev?.seq || 0) + 1 })),
    fitHkh: () => setRecenterSignal((n) => n + 1),
    openChart,
    openGlacier: setSelectedFeature,
    openTerrain: (feature) => setTerrainViewFeature(toTerrainFeature(feature, config?.countryNames || {})),
    closeGlacier: () => {
      setSelectedFeature(null)
      setTerrainViewFeature(null)
    },
  }
  const chatUiState = buildUiState({
    visible: {
      boundary: boundaryVisible,
      pkNational: pkNationalVisible,
      pkProvinces: pkProvincesVisible,
      pkDistricts: pkDistrictsVisible,
      buildings: buildingsVisible,
      popRaster: popRasterVisible,
      landcoverEsri: landcoverEsriVisible,
      era5Annual: era5AnnualVisible,
      rivers: riversVisible,
      hoverInfo: hoverInfoVisible,
      sensorsGlof2: sensorsGlof2Visible,
      sensorsGlof2Damaged: sensorsGlof2DamagedVisible,
      sensorsBriFf: sensorsBriFfVisible,
      sensorsFocus2026: sensorsFocus2026Visible,
      sensorsGmrcWapda: sensorsGmrcWapdaVisible,
    },
    basemap: mapStyleId,
    year: era5AnnualYear,
    zoom: mapZoom,
    glacierId: selectedFeature?.properties?.id,
  })

  return (
    <div id="app">
      <div id="topbar">
        <div id="logo">
          {!logoError ? (
            <img id="ndma-logo" src="/ndma-logo.png" alt="NDMA" onError={() => setLogoError(true)} />
          ) : (
            <div className="logo-fallback">NDMA</div>
          )}
        </div>
        <div id="title">HKH Glacial Retreat Current</div>
        <div id="spacer" />
      </div>

      {config && (
        <MapView
          config={config}
          mapStyleId={mapStyleId}
          era5AnnualVisible={era5AnnualVisible}
          era5AnnualOpacity={era5AnnualOpacity}
          era5AnnualTileUrl={era5AnnualTile?.tileUrlTemplate || null}
          era5AnnualTiles={era5AnnualTiles}
          boundaryVisible={boundaryVisible}
          pkNationalVisible={pkNationalVisible}
          pkProvincesVisible={pkProvincesVisible}
          pkDistrictsVisible={pkDistrictsVisible}
          buildingsVisible={buildingsVisible}
          buildingsIndex={buildingsIndex}
          onFeatureClick={setSelectedFeature}
          recenterSignal={recenterSignal}
          flyToTarget={flyToTarget}
          onZoomChange={setMapZoom}
          popRasterVisible={popRasterVisible}
          popRasterOpacity={popRasterOpacity}
          popRasterTileUrl={popRasterTile?.tileUrlTemplate || null}
          landcoverEsriVisible={landcoverEsriVisible}
          landcoverEsriOpacity={landcoverEsriOpacity}
          landcoverEsriTileUrl={landcoverEsriTile?.tileUrlTemplate || null}
          sensorsGlof2Visible={sensorsGlof2Visible}
          sensorsGlof2DamagedVisible={sensorsGlof2DamagedVisible}
          sensorsBriFfVisible={sensorsBriFfVisible}
          sensorsFocus2026Visible={sensorsFocus2026Visible}
          sensorsGmrcWapdaVisible={sensorsGmrcWapdaVisible}
          riversVisible={riversVisible}
          hoverInfoVisible={hoverInfoVisible}
          hoverInfoYear={era5AnnualYear}
        />
      )}

      <div id="panels">
        <BasemapSwitcher styleId={mapStyleId} onChange={setMapStyleId} />
        <Legend
          onRecenter={() => setRecenterSignal((n) => n + 1)}
          era5Annual={config?.era5Annual}
          era5AnnualVisible={era5AnnualVisible}
          onToggleEra5Annual={setEra5AnnualVisible}
          era5AnnualOpacity={era5AnnualOpacity}
          onEra5AnnualOpacityChange={setEra5AnnualOpacity}
          era5AnnualYear={era5AnnualYear}
          boundaryVisible={boundaryVisible}
          onToggleBoundary={setBoundaryVisible}
          pkNationalVisible={pkNationalVisible}
          onTogglePkNational={setPkNationalVisible}
          pkProvincesVisible={pkProvincesVisible}
          onTogglePkProvinces={setPkProvincesVisible}
          pkDistrictsVisible={pkDistrictsVisible}
          onTogglePkDistricts={setPkDistrictsVisible}
          buildingsVisible={buildingsVisible}
          onToggleBuildings={setBuildingsVisible}
          buildingsStatus={buildingsStatus}
          buildingsError={buildingsError}
          buildingsCount={buildingsIndex?.districts?.length}
          mapZoom={mapZoom}
          popRaster={config?.populationRaster}
          popRasterVisible={popRasterVisible}
          onTogglePopRaster={setPopRasterVisible}
          popRasterOpacity={popRasterOpacity}
          onPopRasterOpacityChange={setPopRasterOpacity}
          popRasterStatus={popRasterStatus}
          popRasterError={popRasterError}
          landcoverEsri={config?.landcoverEsri}
          landcoverEsriVisible={landcoverEsriVisible}
          onToggleLandcoverEsri={setLandcoverEsriVisible}
          landcoverEsriOpacity={landcoverEsriOpacity}
          onLandcoverEsriOpacityChange={setLandcoverEsriOpacity}
          landcoverEsriStatus={landcoverEsriStatus}
          landcoverEsriError={landcoverEsriError}
          sensorsGlof2Visible={sensorsGlof2Visible}
          onToggleSensorsGlof2={setSensorsGlof2Visible}
          sensorsGlof2DamagedVisible={sensorsGlof2DamagedVisible}
          onToggleSensorsGlof2Damaged={setSensorsGlof2DamagedVisible}
          sensorsBriFfVisible={sensorsBriFfVisible}
          onToggleSensorsBriFf={setSensorsBriFfVisible}
          sensorsFocus2026Visible={sensorsFocus2026Visible}
          onToggleSensorsFocus2026={setSensorsFocus2026Visible}
          sensorsGmrcWapdaVisible={sensorsGmrcWapdaVisible}
          onToggleSensorsGmrcWapda={setSensorsGmrcWapdaVisible}
          riversVisible={riversVisible}
          onToggleRivers={setRiversVisible}
          hoverInfoVisible={hoverInfoVisible}
          onToggleHoverInfo={setHoverInfoVisible}
        />
        <AnnualTimeSlider
          visible={era5AnnualVisible}
          range={era5AnnualRange}
          year={era5AnnualYear}
          onYearChange={setEra5AnnualYear}
          playing={era5AnnualPlaying}
          onTogglePlaying={() => setEra5AnnualPlaying((p) => !p)}
          tile={era5AnnualTile}
          status={era5AnnualStatus}
          error={era5AnnualError}
        />
        <DataSheet
          feature={selectedFeature}
          countryNames={config?.countryNames || {}}
          onClose={() => setSelectedFeature(null)}
          onOpenTerrainView={setTerrainViewFeature}
        />
      </div>

      <TerrainView feature={terrainViewFeature} onClose={() => setTerrainViewFeature(null)} />

      <ChartsPanel
        charts={CHART_DEFS.map((d) => ({
          key: d.key,
          variant: d.variant,
          title: d.rowTitle,
          region: d.region,
          status: charts[d.key].status,
          onClick: () => openChart(d.key),
        }))}
      />

      {CHART_DEFS.map((d) => (
        <TrendsPanelStats
          key={d.key}
          open={charts[d.key].open}
          onClose={() => closeChart(d.key)}
          data={charts[d.key].data}
          status={charts[d.key].status}
          error={charts[d.key].error}
          title={d.title}
          sub={d.sub}
          scopeNote={d.scopeNote}
          variant={d.variant}
        />
      ))}

      <ChatPanel
        uiState={chatUiState}
        onActions={(actions) => applyChatActions(actions, chatHandlers)}
        onOpenGlacier={(feature) => openGlacier(feature, chatHandlers)}
      />
    </div>
  )
}
