"""
Region-wide glacier elevation-change vs. temperature trend, over the four
5-year periods (1999-2019, 20 years total) that Hugonnet et al. (2021)
publish per-glacier elevation change for -- that's the actual resolution
the glacier data supports (not truly annual; see backend/data/glaciers.geojson's
`p` field), so temperature is aggregated to match rather than pretending
either series is annual. A fifth period, 2020-2026, extends both series
with the SSP5-8.5 volume projection (`p585`) and ERA5-Land temperature --
see PROJECTED_PERIOD below.
"""

import json
from functools import lru_cache
from pathlib import Path

import ee

import earth_engine

GLACIERS_FILE = Path(__file__).resolve().parent / "data" / "glaciers.geojson"

# The four consecutive periods every glacier in the dataset carries a
# Hugonnet elevation-change figure for (see DataSheet.jsx, which renders
# the same `p` field per-glacier) -- together they span the full 1999-2019
# record.
PERIODS = [(1999, 2004), (2004, 2009), (2009, 2014), (2014, 2019)]

# 2020-2026 SSP5-8.5 volume-projection period, sourced from the `p585`
# field (see the glacier-merge commit) rather than `p` -- kept out of
# PERIODS above since it isn't a Hugonnet et al. 2021 figure. It still
# gets a real temperature figure from get_temperature_trend below, same
# as the historical periods.
PROJECTED_PERIOD = (2020, 2026)

# ECMWF/ERA5/MONTHLY (the legacy collection) stopped updating at 2020-06,
# so it can't cover PROJECTED_PERIOD. ERA5-Land is the still-updated
# replacement (current through at least mid-2026 as of writing) -- but at
# 0.1 degrees vs. the legacy collection's 0.25 degrees, it resolves HKH's
# mountain terrain differently and reads about 0.75 degC cooler for the
# same period over the same boundary. Using the legacy collection for the
# historical periods and switching to ERA5-Land only for PROJECTED_PERIOD
# would show up as a fake ~0.75degC "drop" right at the seam, so every
# period is computed from ERA5-Land for consistency, not just the new one.
ERA5_COLLECTION_ID = "ECMWF/ERA5_LAND/MONTHLY_AGGR"
ERA5_BAND = "temperature_2m"
ERA5_SCALE_M = 11132  # ERA5-Land's native ~0.1 degree resolution

# Standard glacier-ice density assumption used to convert geodetic volume
# change to mass change (Huss, 2013; the same value Hugonnet et al. 2021
# use for their own region-scale mass-change figures) -- a methodological
# choice, not a measured constant, so it's surfaced in the API response.
ICE_DENSITY_KG_M3 = 850


class TrendsUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


@lru_cache(maxsize=None)
def get_glacier_trend(country=None):
    """Area-weighted mean annualized elevation-change rate (m/yr) per
    period, across every glacier in the dataset that has a figure for it --
    or, if `country` is given (an RGI/ISO2 code like "PK"), just the
    glaciers whose `country` property matches. Pure local computation over
    glaciers.geojson -- no network call."""
    with open(GLACIERS_FILE, encoding="utf-8") as f:
        gj = json.load(f)

    results = []
    for start, end in PERIODS + [PROJECTED_PERIOD]:
        field = "p585" if (start, end) == PROJECTED_PERIOD else "p"
        weighted_sum = 0.0
        area_sum = 0.0
        count = 0
        for feat in gj["features"]:
            props = feat["properties"]
            if country is not None and props.get("country") != country:
                continue
            periods = props.get(field)
            if not periods:
                continue
            match = next((row for row in periods if row[0] == start and row[1] == end), None)
            if not match:
                continue
            _, _, elev_change, _, area = match
            if elev_change is None or area is None:
                continue
            weighted_sum += (elev_change / (end - start)) * area
            area_sum += area
            count += 1

        results.append({
            "startYear": start,
            "endYear": end,
            "elevationChangeRateM": (weighted_sum / area_sum) if area_sum else None,
            "glacierCount": count,
            "totalAreaKm2": area_sum,
        })
    return results


@lru_cache(maxsize=None)
def get_mass_balance_trend(country=None):
    """Annualized mass-balance rate (Gt/yr) per period, across every glacier
    in the dataset that has a figure for it (or just one country's, as with
    get_glacier_trend). Unlike the elevation-change rate above, this sums
    each glacier's actual volume change (the `p` field's 4th element, Mm3 --
    see DataSheet.jsx, which labels it "Vol. Delta") rather than averaging a
    per-area rate, so it reflects total ice lost, not a "typical glacier"
    figure. Converted to mass via ICE_DENSITY_KG_M3. Pure local computation
    over glaciers.geojson -- no network call."""
    with open(GLACIERS_FILE, encoding="utf-8") as f:
        gj = json.load(f)

    results = []
    for start, end in PERIODS + [PROJECTED_PERIOD]:
        field = "p585" if (start, end) == PROJECTED_PERIOD else "p"
        volume_sum_mm3 = 0.0  # Mm3 (10^6 m3)
        area_sum = 0.0
        count = 0
        for feat in gj["features"]:
            props = feat["properties"]
            if country is not None and props.get("country") != country:
                continue
            periods = props.get(field)
            if not periods:
                continue
            match = next((row for row in periods if row[0] == start and row[1] == end), None)
            if not match:
                continue
            _, _, _, volume_change, area = match
            if volume_change is None or area is None:
                continue
            volume_sum_mm3 += volume_change
            area_sum += area
            count += 1

        # Mm3 -> m3 (*1e6) -> kg (*density) -> Gt (/1e12), then annualized.
        mass_change_gt = volume_sum_mm3 * 1e6 * ICE_DENSITY_KG_M3 / 1e12
        years = end - start
        results.append({
            "startYear": start,
            "endYear": end,
            "massBalanceRateGtYr": (mass_change_gt / years) if area_sum else None,
            "glacierCount": count,
            "totalAreaKm2": area_sum,
        })
    return results


@lru_cache(maxsize=None)
def get_temperature_trend(country=None):
    """Mean 2m air temperature (degC) over the HKH boundary -- or, if
    `country` is given, just that country's portion of it -- one figure per
    period. A real Earth Engine reduceRegion call per period, cached
    in-process since the underlying ERA5 record doesn't change at runtime."""
    try:
        earth_engine.ensure_init()
        boundary = earth_engine.boundary_geometry(country)
    except earth_engine.EarthEngineUnavailable as exc:
        raise TrendsUnavailable(str(exc)) from exc

    coll = ee.ImageCollection(ERA5_COLLECTION_ID).select(ERA5_BAND)
    results = []
    for start, end in PERIODS + [PROJECTED_PERIOD]:
        filtered = coll.filterDate(f"{start}-01-01", f"{end}-01-01")
        mean_image = filtered.mean()
        stats = mean_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=boundary,
            scale=ERA5_SCALE_M,
            maxPixels=1e9,
            bestEffort=True,
        )
        mean_kelvin = stats.getInfo().get(ERA5_BAND)
        results.append({
            "startYear": start,
            "endYear": end,
            "meanTempC": (mean_kelvin - 273.15) if mean_kelvin is not None else None,
        })
    return results


def get_trends(country=None):
    """Both series, joined period-by-period -- region-wide by default, or
    scoped to one country's glaciers + its portion of the HKH boundary.
    Iterates over the glacier side (rather than the temperature side) so
    that if the two ever disagree on which periods they cover, a period
    missing from `temperature` still comes through with meanTempC set to
    None instead of silently being dropped from the response."""
    temperature = {(t["startYear"], t["endYear"]): t["meanTempC"] for t in get_temperature_trend(country)}
    return [
        {**g, "meanTempC": temperature.get((g["startYear"], g["endYear"]))}
        for g in get_glacier_trend(country)
    ]


def get_mass_balance_trends(country=None):
    """Mass-balance-rate + temperature, joined period-by-period -- the same
    shape as get_trends(), just with massBalanceRateGtYr instead of
    elevationChangeRateM."""
    temperature = {(t["startYear"], t["endYear"]): t["meanTempC"] for t in get_temperature_trend(country)}
    return [
        {**m, "meanTempC": temperature.get((m["startYear"], m["endYear"]))}
        for m in get_mass_balance_trend(country)
    ]
