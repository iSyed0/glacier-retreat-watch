// Bridge between the chatbot and the portal. The backend (backend/chat/
// agent.py) only ever sends actions it has already validated against the
// same names used here; anything unrecognised is ignored, never thrown.

// Chatbot layer name -> the key App.jsx uses for that layer's visibility
// setter. Keep in sync with LAYERS in backend/chat/agent.py and the layer
// list in backend/chat/prompt.py.
export const CHAT_LAYERS = {
  boundary: 'boundary',
  pk_national: 'pkNational',
  pk_provinces: 'pkProvinces',
  pk_districts: 'pkDistricts',
  buildings: 'buildings',
  population: 'popRaster',
  landcover: 'landcoverEsri',
  temperature: 'era5Annual',
  rivers: 'rivers',
  hover_info: 'hoverInfo',
  glof2: 'sensorsGlof2',
  glof2_damaged: 'sensorsGlof2Damaged',
  bri_ff: 'sensorsBriFf',
  focus2026: 'sensorsFocus2026',
  gmrc_wapda: 'sensorsGmrcWapda',
}

const OPACITY_LAYERS = { temperature: 'era5Annual', population: 'popRaster', landcover: 'landcoverEsri' }

const GLACIER_ZOOM = 11

// `h` is the handler object App.jsx builds: setLayer(key, on),
// setOpacity(key, value), setBasemap, setYear, setPlaying, flyTo,
// fitHkh, openChart, openGlacier(feature), openTerrain(feature), closeGlacier.
export function applyChatActions(actions, h) {
  for (const a of actions || []) {
    switch (a.a) {
      case 'layer':
        if (CHAT_LAYERS[a.name]) h.setLayer(CHAT_LAYERS[a.name], a.on)
        break
      case 'opacity':
        if (OPACITY_LAYERS[a.name]) {
          h.setLayer(OPACITY_LAYERS[a.name], true)
          h.setOpacity(OPACITY_LAYERS[a.name], a.value)
        }
        break
      case 'basemap':
        h.setBasemap(a.style)
        break
      case 'year':
        h.setLayer('era5Annual', true)
        h.setYear(a.year)
        break
      case 'play':
        if (a.on) h.setLayer('era5Annual', true)
        h.setPlaying(a.on)
        break
      case 'fly':
        h.flyTo({ lon: a.lon, lat: a.lat, zoom: a.zoom })
        break
      case 'fit_hkh':
        h.fitHkh()
        break
      case 'chart':
        h.openChart(a.key)
        break
      case 'glacier':
        openGlacier(a.feature, h)
        break
      case 'terrain':
        if (a.feature) h.openTerrain(a.feature)
        break
      case 'close':
        h.closeGlacier()
        break
      default:
        break
    }
  }
}

export function openGlacier(feature, h) {
  if (!feature) return
  const [lon, lat] = feature.geometry.coordinates
  h.openGlacier(feature)
  h.flyTo({ lon, lat, zoom: GLACIER_ZOOM })
}

// What's on screen right now, sent with every message so the model can
// answer "what am I looking at" and avoid redundant actions.
export function buildUiState({ visible, basemap, year, zoom, glacierId }) {
  const layerNames = Object.entries(CHAT_LAYERS)
    .filter(([, key]) => visible[key])
    .map(([name]) => name)
  return {
    layers: layerNames,
    basemap,
    year: visible.era5Annual ? year : null,
    zoom: zoom != null ? Math.round(zoom * 10) / 10 : null,
    glacier: glacierId || null,
  }
}
