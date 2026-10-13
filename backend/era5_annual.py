"""
On-demand annual mean air-temperature tiles for the HKH region, 1999-2026 --
ERA5-Land rather than the legacy ERA5 monthly collection trends.py switched
away from (see that module's comment), since it's the one still updating
into 2026. Clipped to HKH_BDA_ASSET_ID (a separate, more detailed boundary
asset from the one era5.py/population_raster.py use -- see earth_engine.py),
matching the GEE Code Editor script this was ported from.
"""

from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import ee

import earth_engine

COLLECTION_ID = "ECMWF/ERA5_LAND/MONTHLY_AGGR"
BAND = "temperature_2m"

MIN_YEAR = 1999  # aligned with the Hugonnet glacier record, not a data limit
MAX_YEAR = 2026  # 2026 is a partial year (collection runs through ~August as
# of writing) -- averaged over whatever months are actually available, same
# as the GEE script this was ported from does, rather than treated specially.

VIS_PARAMS = {
    "min": -15,
    "max": 40,
    "palette": [
        "081D58", "225EA8", "41B6C4", "7FCDBB", "C7E9B4",
        "FFFFCC", "FED976", "FD8D3C", "F03B20", "BD0026",
    ],
}


class Era5AnnualUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


def _collection():
    try:
        earth_engine.ensure_init()
    except earth_engine.EarthEngineUnavailable as exc:
        raise Era5AnnualUnavailable(str(exc)) from exc
    return ee.ImageCollection(COLLECTION_ID).select(BAND)


def _boundary_geometry():
    try:
        return earth_engine.bda_boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise Era5AnnualUnavailable(str(exc)) from exc


def get_year_range():
    """Static -- see MIN_YEAR/MAX_YEAR above -- but a function (like
    era5.get_date_range) so the frontend has one consistent shape to fetch
    range info from regardless of which layer it's asking about."""
    return {"min": MIN_YEAR, "max": MAX_YEAR}


@lru_cache(maxsize=64)
def get_tile_for_year(year: int):
    """Live XYZ tile URL for one calendar year's mean 2m air temperature,
    clipped to the HKH_BDA boundary, plus the same area-mean readout the
    source GEE script showed in its side panel. Cached in-process since
    each call is a real Earth Engine round trip."""
    coll = _collection()
    boundary = _boundary_geometry()

    start = ee.Date.fromYMD(year, 1, 1)
    end = start.advance(1, "year")
    filtered = coll.filterDate(start, end)

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
        "year": year,
        "meanTempC": area_mean,
    }


class Era5AnnualYearInvalid(ValueError):
    """Raised for a year outside MIN_YEAR-MAX_YEAR."""


# Snap hover coordinates to ERA5-Land's own 0.1-degree grid before
# querying, so repeatedly hovering within the same ~10km cell hits the
# in-process cache instead of a fresh Earth Engine round trip every time
# -- the data has no finer spatial detail than this anyway, so snapping
# loses nothing.
GRID_DEG = 0.1


def _snap(value: float, step: float) -> float:
    return round(value / step) * step


@lru_cache(maxsize=4096)
def _point_temp_c(snapped_lon: float, snapped_lat: float, year: int):
    coll = _collection()
    start = ee.Date.fromYMD(year, 1, 1)
    end = start.advance(1, "year")
    mean_c = coll.filterDate(start, end).mean().subtract(273.15)
    point = ee.Geometry.Point([snapped_lon, snapped_lat])
    return mean_c.reduceRegion(
        reducer=ee.Reducer.first(), geometry=point, scale=11132
    ).get(BAND).getInfo()


def get_point_temp(lon: float, lat: float, year: int):
    """Mean annual 2m air temperature (deg C) at (lon, lat) for `year`, or
    None over nodata. Same underlying collection/year-averaging as
    get_tile_for_year, just sampled at a point instead of rendered as a
    tile."""
    if not (MIN_YEAR <= year <= MAX_YEAR):
        raise Era5AnnualYearInvalid(f"year must be {MIN_YEAR}-{MAX_YEAR}")
    return _point_temp_c(_snap(lon, GRID_DEG), _snap(lat, GRID_DEG), year)


@lru_cache(maxsize=1)
def get_all_tiles():
    """Every year's tile in one call, computed concurrently -- the frontend
    fetches this once (see AnnualTimeSlider.jsx) instead of one request per
    year as the slider moves, which was slow enough per-year (each is a
    real Earth Engine round trip) that scrubbing/playing the slider visibly
    lagged and, worse, could apply an in-flight response for a year the
    user had already moved past. A thread pool is enough to parallelize
    this even though the underlying ee calls are synchronous: each is
    I/O-bound (waiting on Earth Engine's API), so the GIL releases while
    one thread's request is in flight and others can proceed. Cached for
    the life of the process, same as population_raster.get_tile()."""
    years = range(MIN_YEAR, MAX_YEAR + 1)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(get_tile_for_year, years))
    return [r for r in results if r is not None]
