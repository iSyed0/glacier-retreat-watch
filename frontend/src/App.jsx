import { useEffect, useState } from 'react'
import './App.css'
import MapView from './components/MapView'
import Legend from './components/Legend'
import PeriodSlider from './components/PeriodSlider'
import DataSheet from './components/DataSheet'
import BasemapSwitcher from './components/BasemapSwitcher'
import TrendsPanelStats from './components/TrendsPanelStats'
import ChartsPanel from './components/ChartsPanel'
import { DEFAULT_MAP_STYLE_ID } from './mapStyles'

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
    key: 'massHkh',
    endpoint: '/api/mass-balance',
    variant: 'mass',
    rowTitle: 'Mass balance + temperature',
    region: 'HKH region',
    title: 'Glacier mass balance vs. temperature',
    sub: 'HKH region · 1999–2019 measured, 2020–2026 WGMS AMCE update',
    scopeNote: 'every HKH glacier',
  },
  {
    key: 'massPk',
    endpoint: '/api/mass-balance/pk',
    variant: 'mass',
    rowTitle: 'Mass balance + temperature',
    region: 'Pakistan',
    title: 'Glacier mass balance vs. temperature — Pakistan',
    sub: 'Pakistan (HKH) · 1999–2019 measured, 2020–2026 WGMS AMCE update',
    scopeNote: 'every glacier inside Pakistan',
  },
]

export default function App() {
  const [config, setConfig] = useState(null)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [logoError, setLogoError] = useState(false)
  const [mapStyleId, setMapStyleId] = useState(DEFAULT_MAP_STYLE_ID)
  const [recenterSignal, setRecenterSignal] = useState(0)

  const [era5PeriodsVisible, setEra5PeriodsVisible] = useState(false)
  const [era5PeriodsOpacity, setEra5PeriodsOpacity] = useState(0.65)
  const [periods, setPeriods] = useState(null) // [{ startYear, endYear }, ...] -- the same 5 windows as the Trends+ charts
  const [periodIndex, setPeriodIndex] = useState(null) // which entry of `periods` is selected -- also drives glacier-dot coloring
  const [era5PeriodsTiles, setEra5PeriodsTiles] = useState({}) // index -> { tileUrlTemplate, startYear, endYear, meanTempC }, all fetched in one batch
  const [era5PeriodsStatus, setEra5PeriodsStatus] = useState('idle') // idle | loading | ready | error -- for the one-time batch fetch, not per-step
  const [era5PeriodsError, setEra5PeriodsError] = useState('')
  const [era5PeriodsPlaying, setEra5PeriodsPlaying] = useState(false)
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

  // Find out the 5 period boundaries (same windows as the Trends+ charts),
  // then default to the earliest.
  useEffect(() => {
    fetch('/api/era5-periods/list')
      .then((r) => {
        if (!r.ok) throw new Error(`list request failed (${r.status})`)
        return r.json()
      })
      .then((list) => {
        setPeriods(list)
        setPeriodIndex(0)
      })
      .catch((err) => setEra5PeriodsError(err.message))
  }, [])

  // Fetch every period's tile in one batch, the first time the layer is
  // switched on -- not one request per step as the slider moves. Each is
  // a real Earth Engine round trip, so per-step fetching (back when this
  // layer had 28 annual steps rather than 5) was slow enough that
  // scrubbing/playing visibly lagged, and a fetch for a step the user had
  // already moved past could still resolve and briefly show stale
  // imagery. era5PeriodsStatus stays 'idle' until this fires, so the
  // guard below only lets it run once.
  useEffect(() => {
    if (!era5PeriodsVisible || era5PeriodsStatus !== 'idle') return
    setEra5PeriodsStatus('loading')
    fetch('/api/era5-periods/tiles')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((tiles) => {
        setEra5PeriodsTiles(Object.fromEntries(tiles.map((t, i) => [i, t])))
        setEra5PeriodsStatus('ready')
      })
      .catch((err) => {
        setEra5PeriodsStatus('error')
        setEra5PeriodsError(err.message)
      })
  }, [era5PeriodsVisible, era5PeriodsStatus])

  // Play/pause: advance one period at a time on a fixed interval, looping
  // back to the first period at the end rather than stopping -- playback
  // only stops when paused manually. Gated on the batch fetch above being
  // done -- every period is instant once it is, so there's no per-frame
  // loading state to juggle during playback.
  useEffect(() => {
    if (!era5PeriodsPlaying || !periods || era5PeriodsStatus !== 'ready') return
    const id = setInterval(() => {
      setPeriodIndex((i) => (i >= periods.length - 1 ? 0 : i + 1))
    }, 1200)
    return () => clearInterval(id)
  }, [era5PeriodsPlaying, periods, era5PeriodsStatus])

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

  // The current period's tile out of the batch fetched above -- looked
  // up, not fetched, so selecting/scrubbing/playing a period is instant.
  const era5PeriodsTile = periodIndex != null ? era5PeriodsTiles[periodIndex] || null : null

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
          era5PeriodsVisible={era5PeriodsVisible}
          era5PeriodsOpacity={era5PeriodsOpacity}
          era5PeriodsTileUrl={era5PeriodsTile?.tileUrlTemplate || null}
          periodIndex={periodIndex}
          boundaryVisible={boundaryVisible}
          pkNationalVisible={pkNationalVisible}
          pkProvincesVisible={pkProvincesVisible}
          pkDistrictsVisible={pkDistrictsVisible}
          buildingsVisible={buildingsVisible}
          buildingsIndex={buildingsIndex}
          onFeatureClick={setSelectedFeature}
          recenterSignal={recenterSignal}
          onZoomChange={setMapZoom}
          popRasterVisible={popRasterVisible}
          popRasterOpacity={popRasterOpacity}
          popRasterTileUrl={popRasterTile?.tileUrlTemplate || null}
          sensorsGlof2Visible={sensorsGlof2Visible}
          sensorsGlof2DamagedVisible={sensorsGlof2DamagedVisible}
          sensorsBriFfVisible={sensorsBriFfVisible}
          sensorsFocus2026Visible={sensorsFocus2026Visible}
          sensorsGmrcWapdaVisible={sensorsGmrcWapdaVisible}
          riversVisible={riversVisible}
        />
      )}

      <div id="panels">
        <BasemapSwitcher styleId={mapStyleId} onChange={setMapStyleId} />
        <Legend
          onRecenter={() => setRecenterSignal((n) => n + 1)}
          era5Periods={config?.era5Periods}
          era5PeriodsVisible={era5PeriodsVisible}
          onToggleEra5Periods={setEra5PeriodsVisible}
          era5PeriodsOpacity={era5PeriodsOpacity}
          onEra5PeriodsOpacityChange={setEra5PeriodsOpacity}
          currentPeriod={periodIndex != null ? periods?.[periodIndex] : null}
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
        />
        <PeriodSlider
          visible={era5PeriodsVisible}
          periods={periods}
          periodIndex={periodIndex}
          onPeriodIndexChange={setPeriodIndex}
          playing={era5PeriodsPlaying}
          onTogglePlaying={() => setEra5PeriodsPlaying((p) => !p)}
          tile={era5PeriodsTile}
          status={era5PeriodsStatus}
          error={era5PeriodsError}
        />
        <DataSheet
          feature={selectedFeature}
          countryNames={config?.countryNames || {}}
          onClose={() => setSelectedFeature(null)}
        />
      </div>

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
    </div>
  )
}
