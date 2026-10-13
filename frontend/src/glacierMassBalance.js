// Mass balance / density for the glacier data sheet (DataSheet.jsx) and its
// animated melt icon (GlacierDensityIcon.jsx).
//
// Two distinct paths, in order of preference:
//
// 1. computeMeasuredDensity() -- a REAL density, for the rare glacier where
//    WGMS field mass-balance records happen to fully cover (every year,
//    no gaps) the same period as one of Hugonnet et al. (2021)'s geodetic
//    volume-change rows. Field balance is an independent mass measurement;
//    Hugonnet gives an independent volume measurement; density = mass /
//    volume needs no assumption at all when both exist for the same
//    glacier and period. Checked against the live dataset: only ~14 of
//    38,781 glaciers qualify.
//
// 2. estimateMassBalanceDensity() -- for every other glacier (the other
//    ~99.96%), which has geodetic elevation change but no field mass
//    balance at all, there's no way to measure mass independently. This
//    instead *assumes* the standard glaciological ice-density constant
//    (850 kg/m^3, the global mean from Huss, M. (2013), "Density
//    assumptions for converting geodetic glacier volume change to mass
//    change", The Cryosphere 7, 877-887 -- the same assumption Hugonnet et
//    al. 2021's own methodology uses) and applies it to the elevation-
//    change rate every glacier already has. This is an ESTIMATE built on a
//    fixed constant, not a measurement -- and per Huss (2013) and our own
//    cross-check below, that constant can be off by roughly 2x for an
//    individual glacier even though it's a reasonable average across many.
//
// See GLACIER_MASS_BALANCE_DENSITY.md for the full writeup, including how
// unreliable path 2 is. Keep that file in sync with any change here.

export const ICE_DENSITY_KG_M3 = 850
export const WATER_DENSITY_KG_M3 = 1000

/**
 * Real, measured density for glacier-periods where it's actually
 * computable: every year in a Hugonnet period has a field mass-balance
 * record (no gaps), so summing those records gives an independently
 * measured mass change to divide by that same period's independently
 * measured (geodetic) volume change.
 *
 * @param {{ mb: Array<[string|number, number]>|null, periods: Array<Array<number>>|null, fallbackArea: number|null }} args
 *   mb: field mass-balance records, [year, balance_m_we] -- NOTE these are
 *   whole meters w.e. per year in this dataset (confirmed: all 371 values
 *   across every glacier with field data are integers from -3 to 1 --
 *   physically impossible as "mm" but a normal annual range in meters),
 *   not millimeters, despite what older code/UI here may have assumed.
 *   periods: Hugonnet period rows, [beginYear, endYear, elevChangeM,
 *   volChangeMm3, areaKm2?] -- the trailing per-period area is present on
 *   some glaciers' rows and absent on others; fallbackArea covers the rows
 *   missing it (the glacier's single top-level area).
 * @returns {Array<{ beginYear: number, endYear: number, densityKgM3: number, yearsUsed: number }>}
 *   One entry per period with full field-data coverage AND a physically
 *   plausible result (see MIN/MAX_PLAUSIBLE_DENSITY_KG_M3 below). Checked
 *   against the live dataset: 25 period-matches exist across ~14 glaciers,
 *   but only 11 (7 glaciers) survive the plausibility filter -- the other
 *   14 come out negative or past 900+ kg/m^3 (one over 9000), an artifact
 *   of field balance being rounded to the nearest whole meter and the
 *   division amplifying that rounding error when the signal is small.
 *   That's the real, demonstrated failure rate of this method at the
 *   individual-glacier level, not a hypothetical caveat.
 */

// Physically possible range for glacier material: ~300 kg/m^3 is a
// generous floor for firn-rich ice, ~917 kg/m^3 is the accepted density of
// bubble-free solid ice (nothing glacial exceeds it). A computed value
// outside this range isn't a surprising real glacier, it's the rounding
// problem above -- so it's dropped rather than shown as if it were valid.
export const MIN_PLAUSIBLE_DENSITY_KG_M3 = 300
export const MAX_PLAUSIBLE_DENSITY_KG_M3 = 917

export function computeMeasuredDensity({ mb, periods, fallbackArea }) {
  if (!mb || !mb.length || !periods || !periods.length) return []
  const mbByYear = new Map(mb.map(([y, v]) => [Number(y), v]))
  const results = []
  for (const row of periods) {
    const [beginYear, endYear, , volChangeMm3, periodArea] = row
    if (volChangeMm3 === null || volChangeMm3 === undefined || volChangeMm3 === 0) continue
    const area = periodArea ?? fallbackArea
    if (area === null || area === undefined) continue

    let sumMWe = 0
    let complete = true
    for (let y = beginYear; y < endYear; y++) {
      if (!mbByYear.has(y)) { complete = false; break }
      sumMWe += mbByYear.get(y)
    }
    if (!complete) continue

    const massKg = sumMWe * WATER_DENSITY_KG_M3 * (area * 1e6)
    const volumeM3 = volChangeMm3 * 1e6
    const densityKgM3 = massKg / volumeM3
    if (densityKgM3 < MIN_PLAUSIBLE_DENSITY_KG_M3 || densityKgM3 > MAX_PLAUSIBLE_DENSITY_KG_M3) continue
    results.push({ beginYear, endYear, densityKgM3, yearsUsed: endYear - beginYear })
  }
  return results
}

/**
 * @param {{ rate: number|null|undefined, area: number|null|undefined }} glacier
 *   rate: elevation change rate, m/yr (same value DataSheet.jsx shows as
 *   "Elevation change rate"). area: glacier area, km^2.
 * @returns {{ specificBalanceMWe: number, massLossTPerYr: number } | null}
 *   specificBalanceMWe: estimated specific mass balance, metres water-
 *   equivalent per year -- the standard glaciological unit for this
 *   quantity (the literature reports "m w.e. yr^-1", not mm; mm w.e. is
 *   normally reserved for glacier-wide/regional totals, not a single
 *   glacier's rate). massLossTPerYr: estimated total mass change for the
 *   whole glacier, tonnes/yr (negative = loss). Returns null when there
 *   isn't enough data (no rate, or no area) to compute either.
 *
 *   Note on units: this is already a *water*-equivalent quantity by
 *   definition (that's what "w.e." means -- it's expressing ice loss as
 *   the depth of water it corresponds to). It stays as a depth-per-area
 *   rate (m w.e./yr) rather than a volume unit like MAF (million acre-
 *   feet): MAF measures a volume, and this is deliberately area-
 *   normalized (so glaciers of different sizes are comparable), so there
 *   isn't an area to multiply by without turning it into a different,
 *   non-comparable number. massLossTPerYr (-> formatMassRateGt below) is
 *   the whole-glacier total this would need to become a volume.
 */
export function estimateMassBalanceDensity({ rate, area }) {
  if (rate === null || rate === undefined || area === null || area === undefined) return null
  const densityRatio = ICE_DENSITY_KG_M3 / WATER_DENSITY_KG_M3 // 0.85
  const specificBalanceMWe = rate * densityRatio // m/yr ice -> m w.e./yr
  const areaM2 = area * 1e6 // km^2 -> m^2
  const massLossTPerYr = (rate * areaM2 * ICE_DENSITY_KG_M3) / 1000 // kg/yr -> t/yr
  return { specificBalanceMWe, massLossTPerYr }
}

/** Human-readable mass-rate string in gigatonnes/yr. Most individual HKH
 * glaciers are small enough that this prints as a small decimal (Gt is
 * the standard unit for regional/global glacier totals, not single small
 * glaciers) -- shown anyway since that's the requested unit; six decimal
 * places keeps even the smallest glaciers' rate visible instead of
 * rounding to "0.000000". */
export function formatMassRateGt(tPerYr) {
  const gt = tPerYr / 1e9
  const sign = gt > 0 ? '+' : ''
  return `${sign}${gt.toFixed(6)} Gt/yr`
}

// 1 tonne of WATER mass occupies exactly 1 m^3 (water density 1000 kg/m^3)
// -- and massLossTPerYr is already a water-equivalent mass (that's what
// the whole ice-density-assumption conversion in estimateMassBalanceDensity
// is for), so it converts straight to a water volume with no extra factor:
// tonnes w.e. == cubic metres of water. From there it's just unit
// arithmetic to acre-feet, then millions of acre-feet (MAF) -- the unit
// Pakistan's own water accounting (e.g. Indus basin flows) is usually
// reported in, which is why this was added alongside Gt/yr rather than
// instead of it. Applicable everywhere "Mass change (est.)" is: wherever
// estimateMassBalanceDensity() returns non-null (rate + area both known),
// which is 38,592 of 38,781 glaciers (99.51%) in the live dataset.
const M3_PER_ACRE_FOOT = 1233.4818375
const ACRE_FEET_PER_MAF = 1e6

export function formatMassRateMaf(tPerYr) {
  const maf = tPerYr / (M3_PER_ACRE_FOOT * ACRE_FEET_PER_MAF)
  const sign = maf > 0 ? '+' : ''
  return `${sign}${maf.toFixed(6)} MAF/yr`
}

// Visual-intensity tier for GlacierDensityIcon's melt animation -- a UI
// framing of the same specificBalanceMWe number above, not a separate
// scientific classification. Thresholds are illustrative design choices;
// see GLACIER_MASS_BALANCE_DENSITY.md.
export function massBalanceTier(specificBalanceMWe) {
  if (specificBalanceMWe === null || specificBalanceMWe === undefined) return 'unknown'
  if (specificBalanceMWe >= -0.05) return 'stable'
  if (specificBalanceMWe >= -0.3) return 'mild'
  if (specificBalanceMWe >= -0.7) return 'moderate'
  return 'severe'
}

// Continuous 0-1 fill level for SeverityBar.jsx, consistent with the tier
// cutoffs above: -0.7 m w.e./yr (the start of "severe") lands at 0.7, so
// the bar is already near-full right where the icon would start its
// fastest drip. -1.0 is just where the scale is defined to reach 1 (full
// bar) -- illustrative, like the tier thresholds, not a literal ceiling;
// anything more extreme still just shows a full bar.
const SEVERITY_FULL_AT_MWE = -1.0

export function massBalanceSeverityFraction(specificBalanceMWe) {
  if (specificBalanceMWe === null || specificBalanceMWe === undefined || specificBalanceMWe >= 0) return 0
  return Math.min(1, specificBalanceMWe / SEVERITY_FULL_AT_MWE)
}
