"""
Gridded population density (people/km^2), HKH-cropped, live from Google
Earth Engine -- same service account as era5.py, via the shared
earth_engine module. Unlike ERA5 there's no month parameter: CIESIN's
GPWv4.11 only publishes one image per 5-year interval (2000/05/10/15/20),
so this always serves the most recent (2020).
"""

from functools import lru_cache

import ee

import earth_engine

COLLECTION_ID = "CIESIN/GPWv411/GPW_Population_Density"
BAND = "population_density"

# Population density in the HKH region is extremely right-skewed -- a
# sample over the study area put the median around 32 people/km^2 and the
# 99th percentile around 700, but individual city-center pixels run into
# the tens of thousands. A linear scale would render the whole region as
# one flat "empty" color with a few maxed-out city pixels; log-scaling the
# band before visualizing it shows gradation at every level instead.
MAX_DENSITY = 10000  # people/km^2 -- above this just clips to the brightest color
VIS_PARAMS = {
    "min": 0,
    "max": 4,  # log10(MAX_DENSITY + 1)
    "palette": [
        "000004", "1b0c41", "4a0c6b", "781c6d", "a52c60",
        "cf4446", "ed6925", "fb9b06", "f7d13d", "fcffa4",
    ],
}


class PopulationRasterUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


@lru_cache(maxsize=1)
def get_tile():
    """Live XYZ tile URL for the most recent population density grid,
    log10-scaled and clipped to the HKH region. Cached in-process -- there's
    only ever one tile to compute (no month parameter like ERA5 has)."""
    try:
        earth_engine.ensure_init()
        boundary = earth_engine.boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise PopulationRasterUnavailable(str(exc)) from exc

    image = ee.ImageCollection(COLLECTION_ID).sort("system:time_start", False).first()
    log_density = image.select(BAND).add(1).log10().rename(BAND)
    clipped = log_density.clip(boundary)

    map_id = clipped.getMapId(VIS_PARAMS)
    return {"tileUrlTemplate": map_id["tile_fetcher"].url_format}
