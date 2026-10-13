# Glacier mass-balance density (estimated)

**Keep this file in sync.** Any change to the calculation, the animation
tiers, or where either is implemented/displayed must be reflected here in
the same change.

## Why this exists

Clicking a glacier point opens `DataSheet.jsx`, which shows real data from
two sources: Hugonnet et al. (2021) geodetic elevation/volume change, and
(for a subset of glaciers) WGMS field-measured mass balance. Geodetic
methods only give elevation/volume change (dh, dV) -- not mass, and
therefore not density either. Field mass-balance records *are* an
independent mass measurement, so wherever both exist for the same glacier
over the same years, density = mass / volume is computable for real. That
almost never happens (see "Measured density" below); for every other
glacier there's no way to measure density, only to assume a standard
constant and see what mass figure it implies.

**Two separate code paths, in order of preference** (both in
[`frontend/src/glacierMassBalance.js`](frontend/src/glacierMassBalance.js)):

1. `computeMeasuredDensity()` -- a **real, measured** density, for the rare
   glacier-period where field data has no gaps across a Hugonnet period.
2. `estimateMassBalanceDensity()` -- an **estimate**, for everything else,
   built on a fixed density constant rather than a measurement.

## 1. Measured density (real, rare)

For a glacier/period where every year in a Hugonnet geodetic period
(`p`/`pRecent`) has a field mass-balance record (`mb`, no gaps), summing
those records gives an independently measured mass change; dividing it by
that period's independently measured volume change gives a real density,
no assumption needed:

```
massKg     = sum(mb over the period, in m w.e.) × 1000 (kg/m³ water) × area (m²)
volumeM3   = Hugonnet volume change for that same period (Mm³ → m³)
density    = massKg / volumeM3
```

**Checked against the live dataset** (`backend/data/glaciers.geojson`,
38,781 glaciers): only ~14 glaciers have field records with no gaps across
any Hugonnet period at all -- 25 period-matches total. Of those 25, only
**11 (7 distinct glaciers)** come out within a physically possible range
for glacier ice/firn (300-917 kg/m³, see `MIN/MAX_PLAUSIBLE_DENSITY_KG_M3`).
The other 14 are not borderline -- one comes out negative, another over
9000 kg/m³ (ten times denser than solid ice). That's the field mb values
being rounded to the nearest whole meter: summing a handful of heavily
rounded numbers and dividing by a comparatively small volume change
amplifies that rounding error enough to blow past physical limits.
`computeMeasuredDensity()` drops anything outside that range rather than
showing it, so what reaches the UI is never a nonsense number -- but it
also means **well under 0.1% of glaciers in this dataset will ever show a
measured density.**

(Separately: the field `mb` values in this dataset are whole-number meters
of water-equivalent per year, e.g. `-1`, `0`, `-2` -- confirmed by checking
the full set of 371 recorded values, all integers from -3 to 1, which is a
normal annual range in meters and would be physically meaningless as
millimeters. The UI used to label this column "mm w.e."; that was a
pre-existing bug, fixed alongside this feature to read "m w.e.".)

## 2. Estimated mass balance (assumed constant, everything else)

For the other 38,700+ glaciers -- no field data at all -- there's no way
to measure mass independently, so this instead *assumes* the standard
glaciological ice-density constant and applies it to the elevation-change
rate every glacier already has:

- **Ice density**: 850 kg/m³ — the global-mean density assumption from
  Huss, M. (2013), *"Density assumptions for converting geodetic glacier
  volume change to mass change"*, The Cryosphere 7, 877–887. This is the
  same assumption Hugonnet et al. (2021)'s own methodology uses, so it's
  consistent with the elevation/volume data already shown on the card.
- **Water density**: 1000 kg/m³ (for the water-equivalent conversion).

```
densityRatio        = 850 / 1000 = 0.85
specificBalanceMWe   = rate (m/yr) × densityRatio          // m w.e./yr
massLossTPerYr       = rate (m/yr) × area (km² → m²) × 850 / 1000   // t/yr
```

Where `rate` and `area` are the same `p.rate` (m/yr) and `p.area` (km²)
values DataSheet.jsx already reads from the glacier's GeoJSON properties
(the "Elevation change rate" / "Glacier area" stat tiles). If either is
missing, `estimateMassBalanceDensity()` returns `null` and the UI shows
"—" instead of a fabricated number.

**Units**: `specificBalanceMWe` is in **m w.e./yr** (metres, not
millimetres — the standard glaciological convention for a single
glacier's rate; mm w.e. is normally reserved for glacier-wide/regional
totals). `massLossTPerYr` is displayed via `formatMassRateGt()` in
**Gt/yr**, since that was requested over the earlier auto-scaling t/kt/Mt
format — note Gt is the unit regional/global glacier studies use, so for
most individual HKH glaciers (small, often <20 km²) this prints as a small
decimal (six places, so it doesn't just round to "0.000000").

**Why not MAF (million acre-feet) for "Mass balance"?** MAF is a *volume*
unit; "Mass balance (est.)" is a *per-area rate* (m w.e./yr), deliberately
area-normalized so glaciers of different sizes are directly comparable —
there's no area left to multiply by to turn it into a volume without
undoing that normalization. "Mass change" (the whole-glacier total) *is*
that volume quantity, so it gets MAF as a second unit alongside Gt/yr (see
below), not a replacement for Mass balance's m w.e./yr.

**MAF, on "Mass change"**: `formatMassRateMaf()` converts the same
`massLossTPerYr` used for Gt/yr into million acre-feet/yr. The conversion
has no extra assumption beyond what's already in `massLossTPerYr`: 1
tonne of water-equivalent mass occupies exactly 1 m³ of water (water
density 1000 kg/m³), so tonnes-of-mass and m³-of-water-volume are the same
number; from there it's just m³ → acre-feet → MAF. Added because Pakistan's
own water accounting (Indus basin flows, reservoir levels) is usually
reported in MAF, making it a more locally legible unit than Gt here.
Applicable wherever "Mass change (est.)" already is -- same `density`
result, just reformatted -- which is 38,592 of 38,781 glaciers (99.51%,
everywhere `rate` and `area` are both known). Shown as a third stat tile,
`ds-stats-density .ds-stat:last-child`, spanning the full row.

**Why do the Gt/yr and MAF/yr numbers differ**, given they're built from
the same `massLossTPerYr`? Because Gt and MAF are different-*sized* units,
not two labels for the same count -- 1 Gt = 1 km³ = 1×10⁹ m³, while 1 MAF
≈ 1.233×10⁹ m³. The same volume is a smaller number of (bigger) MAF units
than of (smaller) Gt-equivalent-km³ units: MAF ≈ Gt × 0.811. E.g.
-0.000019 Gt/yr × 0.811 ≈ -0.000015 MAF/yr -- matches exactly.

**How unreliable is this, concretely?** The 7 glaciers with a measured
density above give a direct read on it: their real densities are 418,
452, 487, 754, 777, 788, 811 kg/m³ -- a roughly 2x spread (418 to 811),
all using the *same* single glacier type, region, and era this app covers.
Using the fixed 850 kg/m³ assumption on the lowest of those (418) would
overstate that glacier's mass loss by almost exactly 2x. Huss (2013) itself
is explicit that 850 kg/m³ is only a reasonable midpoint *in aggregate*
over many glaciers or long periods -- not something that holds up applied
to any one glacier individually, which is exactly what the "Mass balance
(est.)" / "Mass change (est.)" tiles do. They're the best available number
for the ~38,700 glaciers with nothing else, not a trustworthy figure for
any single one of them.

## Where it's displayed

`frontend/src/components/DataSheet.jsx` renders the glacier card as two
tabs (`ds-tabs` / `ds-tab`), "Mass Balance" shown first by default (and
reset to it every time a different glacier is clicked). Named "Mass
Balance", not "Density" (its name until this note was added) -- nearly
everything in it (the icon, severity bar, Mass balance/change/MAF tiles)
is a mass quantity built by *assuming* a density constant, not a measured
density; the one real density value, the "Measured density" tile, only
appears for ~7 of 38,781 glaciers (see "Measured density" above). The tab
was named after that minority case for a while; fixed to name it after
what it actually mostly shows.

- **Mass Balance tab**: the retreating/stable badge, then a `ds-density-hero`
  card containing the animated melt icon (`GlacierDensityIcon.jsx`,
  `size={220}`) side by side with a vertical severity gauge
  (`SeverityBar.jsx`, `height={200}`) -- fill height and color (blue ->
  red) both track `massBalanceSeverityFraction()`, replacing an earlier
  text tier label ("mild/moderate/severe estimated loss") that read less
  clearly at a glance; the same wording now only lives in the bar's hover
  title. Below that, three stat tiles at a larger font size
  (`ds-stats-density`): "Mass
  balance (est.)" (m w.e./yr), "Mass change (est.)" (Gt/yr), and "Mass
  change, water vol. (est.)" (MAF/yr, spanning the full row). If
  `computeMeasuredDensity()` found a plausible result for this glacier, a
  highlighted "Measured density (begin–end)" tile (`ds-stat-measured`)
  also appears underneath, labeled with the specific period it came from,
  visually distinct from the always-assumed tiles above it. The
  `#datasheet` panel itself is 380px wide (was 340px) to give the larger
  icon room.
- **Details tab**: everything else that was already on the card --
  elevation-change rate, glacier area, and the Hugonnet/WGMS AMCE/field
  mass-balance/front-variation tables (field balance now correctly
  labeled "m w.e.", not "mm w.e.").

The citation footer that used to sit at the bottom of the card (WGMS/
Hugonnet/Dussaillant sources, the 850 kg/m³ disclosure, and the glacier ID)
was removed from the UI on 2026-10-01 to keep the card shorter. The exact
text is archived in [`GLACIER_DATA_SOURCES.md`](GLACIER_DATA_SOURCES.md),
not deleted outright, in case it's needed again.

## The animated icon

`frontend/src/components/GlacierDensityIcon.jsx` + the `.glacier-density-icon`
/ `.gdi-*` rules in `frontend/src/App.css`.

A small inline SVG glacier glyph, animated with CSS keyframes rather than a
pre-rendered image/GIF, so its animation reflects each glacier's own
`specificBalanceMWe` instead of one static asset shared by every glacier.
Always-on touches regardless of tier: a soft glow filter behind the ice
body, a crevasse line for texture, and a gently pulsing meltwater pool.
`massBalanceTier()` in `glacierMassBalance.js` buckets the balance number
into a tier, which drives drip count and fall speed on top of that:

| Tier       | specificBalanceMWe    | Drips | Fall duration |
|------------|-----------------------|-------|----------------|
| `unknown`  | no data               | 0     | — (dimmed, static) |
| `stable`   | ≥ −0.05               | 0     | — (gentle shimmer instead) |
| `mild`     | −0.05 to −0.3         | 1     | 3.2s |
| `moderate` | −0.3 to −0.7          | 2     | 1.9s |
| `severe`   | < −0.7                | 3     | 1.0s |

**These thresholds are illustrative UI design choices, not a scientific
classification.** They exist only to make the already-computed
`specificBalanceMWe` number visually legible at a glance; they were picked
by eye against the range of values real HKH glaciers produce, not derived
from any glaciological threshold in the literature. If the computed value is
`null` (no rate/area data), the icon renders dimmed and static rather than
guessing.

**`DataSheet.jsx` shows a "360° Terrain View" button for every glacier**,
not just `severe`-tier ones (it did at first; opened up on request) -- a
synthesized 3D satellite+terrain camera orbit. Deliberately not called
"drone view" -- there's no aerial/drone footage dataset for these
glaciers anywhere in this project, and the name shouldn't imply there is.

There used to be a real RGI7 glacier-outline overlay drawn on top of the
satellite imagery here (first a cyan fill with a yellow border, then just
the cyan fill after the border was removed for reading as too strong a
highlight) -- backed by `/api/glacier-outline`, which did a point lookup
against RGI7 polygons since `glaciers.geojson`'s RGI6 references don't
map cleanly onto RGI7's renumbered outlines. Removed entirely on request
("remove the highlights around the glacier points in the satellite 360
view"), along with its backend (`glacier_outline.py` and the endpoint, both
deleted -- nothing else called them) and the `outlineStatusRef` status
line. If a glacier-extent overlay is wanted again, the point-lookup
approach documented here is still the right one; it would just need
rebuilding from scratch.

**TerrainView.jsx is a two-stop tour, not a single static view.** The
camera starts zoomed out on the globe *directly over the clicked glacier*
(`center: [firstStop.lon, firstStop.lat]`, zoom 2.5 -- starting elsewhere
let the globe flight sweep the long way round and pass the wrong side
before arriving) and flies in (Mapbox's `flyTo`,
matching the camera-fly pattern Mapbox's own SDK examples use) to the
clicked glacier, orbits it, then flies to the **nearest real glacier with
the opposite trend** -- `/api/nearest-glacier` (`backend/nearest_glacier.py`),
a haversine nearest-neighbor scan over `glaciers.geojson` for the closest
point with that trend within 50km -- and back, looping. Clicking a
balanced glacier searches for the nearest *retreating* one instead of the
other way around (`searchTrend = feature.trend === 1 ? -1 : 1` in
`TerrainView.jsx`); a `trend: 0` ("no significant trend") glacier is
treated like a retreating one for this purpose and searches for a
balanced neighbor. This is the real, data-driven version of the
divergence case saved in memory for the user's presentation (avalanche
nourishment / debris insulation / aspect differences letting one glacier
stay balanced beside retreating neighbors): clicking RGI60-14.00408 (rate
-0.83 m/yr) flies to RGI60-14.00330 (the Wakhan Corridor example used
throughout this project), its nearest balanced neighbor at 8.0km; clicking
that same RGI60-14.00330 the other direction finds RGI60-14.05390, a
5.9km² retreating glacier only 1.3km away -- verified both directions
return real, sensible results, not just the one pair this was designed
around. If no glacier of the needed trend is within 50km, the tour
silently stays on the clicked glacier and just keeps orbiting it
(`scheduleNext` checks `secondStop` and returns early if it's still
null) -- there's no status line for this in the info panel anymore (one
existed briefly; removed on request along with the outline status note),
so there's currently no visible way to tell "still looking" apart from
"nothing nearby" from the UI alone.

**Gotcha if you touch the rotation or the fly animation**: the orbit
tick loop calls `map.setBearing()` every frame, which fights Mapbox's own
camera interpolation during a `flyTo` -- running both at once froze the
translation in place while the view kept spinning, so the camera never
visibly arrived at the second stop even though the info panel did update
(the `onArrive` callback fired correctly; only the animation looked
stuck). Fixed with a `flying` flag (`TerrainView.jsx`) that
`flyToStop()` sets before calling `map.flyTo()` and clears when its
matching timer fires, checked by `tick()` alongside the existing
`dragging` check. Any future direct camera mutation in the rotation loop
needs the same guard, or this regresses.

**Flight pacing** (also tuned on request, after the fix above made the
flight actually visible): both durations were increased --
`FLY_IN_DURATION_MS` 5000→7500ms, `FLY_BETWEEN_DURATION_MS` 6000→9500ms --
and the between-stops flight gets `minZoom: BETWEEN_STOPS_MIN_ZOOM` (8.5)
passed to `flyTo()`. Both stops sit at the same zoom (14), so without a
`minZoom` floor `flyTo` has little reason to arc the camera up and tends
to pan low, fast, and close to the ground between two nearby points,
which read as jerky rather than a smooth flight; forcing a pull-back to
zoom 8.5 at the midpoint gives it a proper rise-travel-descend arc. Not
applied to the initial globe-entrance flight, which already arcs
naturally since it starts at zoom ~1.2.

The second stop's mass-balance figures are computed client-side with the
same `estimateMassBalanceDensity()` / `formatMassRateGt()` used
everywhere else, from the rate/area `/api/nearest-glacier` returns -- not
pre-computed server-side.

## Updating this feature

If you change the density constant, the formula, the displayed units, the
animation tiers, or move any of this to a different file — update the
corresponding section above in the same change. This file is the single
place that explains *why* the numbers on the glacier card are what they are;
letting it drift from the code defeats the point of having it.

**Melt overlay in the 360 view** (`TerrainView.jsx`, `#terrain-view-melt` in
`App.css`): a melt effect anchored to the glacier's screen point via
`map.project()`, re-positioned on every `move` event so it tracks the orbit.
It fades in with zoom (opacity from 10.5 to 12.5) so it appears as the camera
closes in, and is started when a flight begins (`flyToStop` -> `setMeltFor`)
so it is already visible during the approach. Severity uses the same
`massBalanceTier()` and `massBalanceSeverityFraction()` as the Mass Balance
tab: drip count (mild 1, moderate 2, severe 3), fall speed, and pool size
(`--melt-scale`). Balanced and unknown stops get no melt. The tier thresholds
are the same illustrative ones documented above, not a scientific model.
