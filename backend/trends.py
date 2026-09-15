"""
Region-wide glacier elevation-change vs. temperature trend, over the same
four 5-year periods (1999-2019, 20 years total) that Hugonnet et al. (2021)
publish per-glacier elevation change for -- that's the actual resolution
the glacier data supports (not truly annual; see backend/data/glaciers.geojson's
`p` field), so temperature is aggregated to match rather than pretending
either series is annual.
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

ERA5_COLLECTION_ID = "ECMWF/ERA5/MONTHLY"
ERA5_BAND = "mean_2m_air_temperature"


class TrendsUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


@lru_cache(maxsize=1)
def get_glacier_trend():
    """Area-weighted mean annualized elevation-change rate (m/yr) per
    period, across every glacier in the dataset that has a figure for it.
    Pure local computation over glaciers.geojson -- no network call."""
    with open(GLACIERS_FILE, encoding="utf-8") as f:
        gj = json.load(f)

    results = []
    for start, end in PERIODS:
        weighted_sum = 0.0
        area_sum = 0.0
        count = 0
        for feat in gj["features"]:
            periods = feat["properties"].get("p")
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


@lru_cache(maxsize=1)
def get_temperature_trend():
    """Mean 2m air temperature (degC) over the HKH boundary, one figure per
    period -- a real Earth Engine reduceRegion call per period, cached
    in-process since the underlying ERA5 record doesn't change at runtime."""
    try:
        earth_engine.ensure_init()
        boundary = earth_engine.boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise TrendsUnavailable(str(exc)) from exc

    coll = ee.ImageCollection(ERA5_COLLECTION_ID).select(ERA5_BAND)
    results = []
    for start, end in PERIODS:
        filtered = coll.filterDate(f"{start}-01-01", f"{end}-01-01")
        mean_image = filtered.mean()
        stats = mean_image.reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=boundary,
            scale=25000,
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


def get_trends():
    """Both series, joined period-by-period."""
    glacier = {(p["startYear"], p["endYear"]): p for p in get_glacier_trend()}
    temperature = get_temperature_trend()
    return [
        {**glacier[(t["startYear"], t["endYear"])], "meanTempC": t["meanTempC"]}
        for t in temperature
    ]
