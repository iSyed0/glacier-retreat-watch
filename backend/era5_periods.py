"""
On-demand mean air-temperature tiles for the HKH region, one per period in
periods.ALL_PERIODS -- ERA5-Land rather than the legacy ERA5 monthly
collection trends.py switched away from (see that module's comment), since
it's the one still updating into 2026. Clipped to HKH_BDA_ASSET_ID (a
separate, more detailed boundary asset from the one population_raster.py
uses -- see earth_engine.py).

Originally per-year (ported from a GEE Code Editor script with a year
slider): fetching one tile per year on demand meant scrubbing/playing the
slider visibly lagged (each tile is a real Earth Engine round trip), and a
slow response for a year the user had already moved past could still land
and briefly show stale imagery. Switched to periods.ALL_PERIODS (5-year
Hugonnet windows plus one recent one) both because that's the resolution
the glacier side of this same slider actually supports (see
glaciers.geojson's `p`/`pRecent` fields) and because 5 periods fetched
once, up front, sidesteps the lag/staleness problem entirely.
"""

from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import ee

import earth_engine
from periods import ALL_PERIODS

COLLECTION_ID = "ECMWF/ERA5_LAND/MONTHLY_AGGR"
BAND = "temperature_2m"

VIS_PARAMS = {
    "min": -15,
    "max": 40,
    "palette": [
        "081D58", "225EA8", "41B6C4", "7FCDBB", "C7E9B4",
        "FFFFCC", "FED976", "FD8D3C", "F03B20", "BD0026",
    ],
}


class Era5PeriodsUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


def _collection():
    try:
        earth_engine.ensure_init()
    except earth_engine.EarthEngineUnavailable as exc:
        raise Era5PeriodsUnavailable(str(exc)) from exc
    return ee.ImageCollection(COLLECTION_ID).select(BAND)


def _boundary_geometry():
    try:
        return earth_engine.bda_boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise Era5PeriodsUnavailable(str(exc)) from exc


def get_periods():
    """The period boundaries the frontend builds its slider steps from --
    a function (like the old get_year_range) so callers don't need to
    import periods.py themselves just to know the shape."""
    return [{"startYear": s, "endYear": e} for s, e in ALL_PERIODS]


def _get_tile_for_period(period):
    """Live XYZ tile URL for one period's mean 2m air temperature, clipped
    to the HKH_BDA boundary, plus the area-mean readout. Not cached on its
    own -- get_all_tiles() below is the entry point, and it's what's
    actually called repeatedly (the lru_cache there is what matters)."""
    start, end = period
    coll = _collection()
    boundary = _boundary_geometry()

    filtered = coll.filterDate(f"{start}-01-01", f"{end}-01-01")
    if filtered.size().getInfo() == 0:
        return None

    mean_c = filtered.mean().subtract(273.15).rename("temperature_C")
    clipped = mean_c.clip(boundary)

    map_id = clipped.getMapId(VIS_PARAMS)
    area_mean = clipped.reduceRegion(
        reducer=ee.Reducer.mean(),
        geometry=boundary,
        scale=11132,  # ERA5-Land's native ~0.1 degree resolution
        maxPixels=1e10,
        bestEffort=True,
    ).get("temperature_C").getInfo()

    return {
        "tileUrlTemplate": map_id["tile_fetcher"].url_format,
        "startYear": start,
        "endYear": end,
        "meanTempC": area_mean,
    }


@lru_cache(maxsize=1)
def get_all_tiles():
    """Every period's tile in one call, computed concurrently -- the
    frontend fetches this once, the first time the layer is switched on,
    into a lookup map rather than fetching per period as the slider moves.
    A thread pool is enough to parallelize this even though the underlying
    ee calls are synchronous: each is I/O-bound (waiting on Earth Engine's
    API), so the GIL releases while one thread's request is in flight and
    others can proceed. Cached for the life of the process, same as
    population_raster.get_tile()."""
    with ThreadPoolExecutor(max_workers=len(ALL_PERIODS)) as pool:
        results = list(pool.map(_get_tile_for_period, ALL_PERIODS))
    return [r for r in results if r is not None]
