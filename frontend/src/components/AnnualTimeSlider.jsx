// Floating time-scrubber for the annual-temperature map layer -- lives on
// the map itself (bottom-center, full-width bar) rather than crammed into
// the Legend's 250px column, where a label+slider+value+play-button row
// didn't fit and silently clipped (see git history). The Legend still owns
// the layer's on/off toggle, opacity and color scale, matching every other
// raster layer -- this bar only owns the "which year" control.
export default function AnnualTimeSlider({
  visible,
  range,
  year,
  onYearChange,
  playing,
  onTogglePlaying,
  tile,
  status,
  error,
}) {
  if (!visible || !range || year == null) return null

  return (
    <div id="annual-time-slider">
      <div className="ats-top">
        <span className="ats-title">Annual temperature (2m) &middot; {year}</span>
        {status === 'error' ? (
          <span className="ats-temp ats-temp-error">No data{error ? ` — ${error}` : ''}</span>
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
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <span className="ats-bound">{range.min}</span>
        <input
          type="range"
          className="ats-slider"
          min={range.min}
          max={range.max}
          step="1"
          value={year}
          onChange={(e) => onYearChange(Number(e.target.value))}
        />
        <span className="ats-bound">{range.max}</span>
      </div>
    </div>
  )
}
