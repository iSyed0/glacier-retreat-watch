// Basemap options for the style switcher. Every style here supports the
// 'globe' projection used by MapView, so switching never drops out of globe
// view -- only the tiles underneath change.
export const MAP_STYLES = [
  { id: 'satellite-streets', label: 'Satellite', url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'streets', label: 'Streets', url: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'outdoors', label: 'Terrain', url: 'mapbox://styles/mapbox/outdoors-v12' },
  { id: 'light', label: 'Light', url: 'mapbox://styles/mapbox/light-v11' },
  { id: 'dark', label: 'Dark', url: 'mapbox://styles/mapbox/dark-v11' },
]

export const DEFAULT_MAP_STYLE_ID = 'satellite-streets'
