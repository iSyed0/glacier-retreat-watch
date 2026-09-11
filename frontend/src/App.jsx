import { useEffect, useState } from 'react'
import './App.css'
import MapView from './components/MapView'
import Legend from './components/Legend'
import DataSheet from './components/DataSheet'
import BasemapSwitcher from './components/BasemapSwitcher'
import { DEFAULT_MAP_STYLE_ID } from './mapStyles'

export default function App() {
  const [config, setConfig] = useState(null)
  const [selectedFeature, setSelectedFeature] = useState(null)
  const [logoError, setLogoError] = useState(false)
  const [mapStyleId, setMapStyleId] = useState(DEFAULT_MAP_STYLE_ID)

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

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch((err) => console.error('Failed to load config:', err))
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
          era5Visible={era5Visible}
          era5Opacity={era5Opacity}
          era5TileUrl={era5Tile?.tileUrlTemplate || null}
          boundaryVisible={boundaryVisible}
          pkNationalVisible={pkNationalVisible}
          pkProvincesVisible={pkProvincesVisible}
          pkDistrictsVisible={pkDistrictsVisible}
          onFeatureClick={setSelectedFeature}
        />
      )}

      <div id="panels">
        <BasemapSwitcher styleId={mapStyleId} onChange={setMapStyleId} />
        <Legend
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
        />
        <DataSheet
          feature={selectedFeature}
          countryNames={config?.countryNames || {}}
          onClose={() => setSelectedFeature(null)}
        />
      </div>
    </div>
  )
}
