import { useEffect, useState } from 'react'
import './App.css'
import MapView from './components/MapView'
import Legend from './components/Legend'
import DataSheet from './components/DataSheet'
import BasemapSwitcher from './components/BasemapSwitcher'
import TrendsPanel from './components/TrendsPanel'
import { DEFAULT_MAP_STYLE_ID } from './mapStyles'

export default function App() {
  const [config, setConfig] = useState(null)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [logoError, setLogoError] = useState(false)
  const [mapStyleId, setMapStyleId] = useState(DEFAULT_MAP_STYLE_ID)
  const [recenterSignal, setRecenterSignal] = useState(0)

  const [era5Visible, setEra5Visible] = useState(false)
  const [era5Opacity, setEra5Opacity] = useState(0.65)
  const [era5Range, setEra5Range] = useState(null) // { min: 'YYYY-MM', max: 'YYYY-MM' }
  const [era5Month, setEra5Month] = useState('') // the month the user has selected, 'YYYY-MM'
  const [era5Tile, setEra5Tile] = useState(null) // { tileUrlTemplate, date }
  const [era5Status, setEra5Status] = useState('idle') // idle | loading | ready | error
  const [era5Error, setEra5Error] = useState('')
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
  const [trendsOpen, setTrendsOpen] = useState(false)
  const [trendsData, setTrendsData] = useState(null)
  const [trendsStatus, setTrendsStatus] = useState('idle') // idle | loading | ready | error
  const [trendsError, setTrendsError] = useState('')

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

  // Find out which months are actually queryable, then default to the most recent.
  useEffect(() => {
    fetch('/api/era5/range')
      .then((r) => {
        if (!r.ok) throw new Error(`range request failed (${r.status})`)
        return r.json()
      })
      .then((range) => {
        setEra5Range(range)
        setEra5Month(range.max)
      })
      .catch((err) => setEra5Error(err.message))
  }, [])

  // Fetch a fresh tile whenever the selected month changes.
  useEffect(() => {
    if (!era5Month) return
    const [year, month] = era5Month.split('-').map(Number)
    setEra5Status('loading')
    setEra5Error('')
    fetch(`/api/era5/tile?year=${year}&month=${month}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((tile) => {
        setEra5Tile(tile)
        setEra5Status('ready')
      })
      .catch((err) => {
        setEra5Status('error')
        setEra5Error(err.message)
      })
  }, [era5Month])

  // Fetch trend data the first time the panel is opened, not on mount --
  // it's a handful of real Earth Engine + local-computation calls on the
  // backend, worth deferring until someone actually asks to see it.
  const openTrends = () => {
    setTrendsOpen(true)
    if (trendsStatus !== 'idle') return
    setTrendsStatus('loading')
    fetch('/api/trends')
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}))
          throw new Error(body.detail || `request failed (${r.status})`)
        }
        return r.json()
      })
      .then((data) => {
        setTrendsData(data)
        setTrendsStatus('ready')
      })
      .catch((err) => {
        setTrendsStatus('error')
        setTrendsError(err.message)
      })
  }

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
        <div id="spacer">
          <button type="button" className="topbar-trends-btn" onClick={openTrends}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 17 9 11 13 15 21 6" />
              <polyline points="15 6 21 6 21 12" />
            </svg>
            Trends
          </button>
        </div>
      </div>

      {config && (
        <MapView
          config={config}
          mapStyleId={mapStyleId}
          era5Visible={era5Visible}
          era5Opacity={era5Opacity}
          era5TileUrl={era5Tile?.tileUrlTemplate || null}
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
        />
      )}

      <div id="panels">
        <BasemapSwitcher styleId={mapStyleId} onChange={setMapStyleId} />
        <Legend
          onRecenter={() => setRecenterSignal((n) => n + 1)}
          era5={config?.era5}
          era5Visible={era5Visible}
          onToggleEra5={setEra5Visible}
          era5Opacity={era5Opacity}
          onOpacityChange={setEra5Opacity}
          era5Range={era5Range}
          era5Month={era5Month}
          onMonthChange={setEra5Month}
          era5Date={era5Tile?.date}
          era5Status={era5Status}
          era5Error={era5Error}
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
        />
        <DataSheet
          feature={selectedFeature}
          countryNames={config?.countryNames || {}}
          onClose={() => setSelectedFeature(null)}
        />
      </div>

      <TrendsPanel
        open={trendsOpen}
        onClose={() => setTrendsOpen(false)}
        data={trendsData}
        status={trendsStatus}
        error={trendsError}
      />
    </div>
  )
}
