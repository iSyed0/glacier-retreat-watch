// Floating time-scrubber for the period-temperature map layer -- lives on
// the map itself (bottom-center, full-width bar) rather than crammed into
// the Legend's 250px column, where a label+slider+value+play-button row
// didn't fit and silently clipped (see git history). The Legend still owns
// the layer's on/off toggle, opacity and color scale, matching every other
// raster layer -- this bar only owns "which period" (which also drives
// glacier-dot coloring on the map -- see MapView.jsx's periodIndex prop).
//
// Every period's tile is fetched in one batch as soon as the layer is
// switched on (see App.jsx), not one request per step as the slider
// moves -- so `status` here is that one-time batch fetch, not a per-frame
// loading state. Once it's 'ready', scrubbing/playing is instant.
//
// Originally a continuous 1999-2026 year slider; switched to 5 discrete
// steps (the same periods as the Trends+ charts and DataSheet) since
// that's the resolution the glacier side of this data actually supports
// -- annual figures for it would be a downscaling model's estimate, not
// a direct measurement (see conversation/commit history).
function periodLabel(p) {
  return `${p.startYear}–${p.endYear}`
}

export default function PeriodSlider({
  visible,
  periods,
  periodIndex,
  onPeriodIndexChange,
  playing,
  onTogglePlaying,
  tile,
  status,
  error,
}) {
  if (!visible || !periods || !periods.length || periodIndex == null) return null

  const loading = status === 'loading'
  const current = periods[periodIndex]

  return (
    <div id="period-slider">
      <div className="ats-top">
        <span className="ats-title">Temperature &amp; glacier retreat &middot; {periodLabel(current)}</span>
        {status === 'error' ? (
          <span className="ats-temp ats-temp-error">Unavailable{error ? ` — ${error}` : ''}</span>
        ) : loading ? (
          <span className="ats-temp">Loading all periods…</span>
        ) : (
          <span className="ats-temp">
            HKH average: {tile?.meanTempC != null ? `${tile.meanTempC.toFixed(1)}°C` : '…'}
          </span>
        )}
      </div>
      <div className="ats-row">
        <button
          type="button"
          className="ats-play"
          onClick={onTogglePlaying}
          disabled={loading}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          className="ats-slider"
          min={0}
          max={periods.length - 1}
          step={1}
          value={periodIndex}
          onChange={(e) => onPeriodIndexChange(Number(e.target.value))}
        />
      </div>
      <div className="ats-ticks">
        {periods.map((p, i) => (
          <button
            key={i}
            type="button"
            className={`ats-tick${i === periodIndex ? ' active' : ''}`}
            onClick={() => onPeriodIndexChange(i)}
          >
            {periodLabel(p)}
          </button>
        ))}
      </div>
    </div>
  )
}
