import { MAP_STYLES } from '../mapStyles'

export default function BasemapSwitcher({ styleId, onChange }) {
  return (
    <div id="basemap-switcher">
      {MAP_STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          className={s.id === styleId ? 'active' : ''}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
