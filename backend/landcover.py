"""
Sentinel-2 10m annual land cover (2017-2025), HKH-cropped, live from
Google Earth Engine -- same service account as era5_annual.py/
population_raster.py, via the shared earth_engine module.

Source: Esri / Impact Observatory's Sentinel-2 10m Annual Land Use Land
Cover time series (the same data backing the ArcGIS Living Atlas "Land
Cover Explorer" the user linked), mirrored into Earth Engine's public
community catalog (awesome-gee-community-catalog / sat-io) --
https://gee-community-catalog.org/projects/S2TSLULC/. Creative Commons
BY-4.0. Each annual layer is a composite of that year's classifications
built to ~75%+ average accuracy, not a single clean observation.

The collection is tiled by UTM zone (6654 images = ~740 tiles x 9 years),
so a single year's HKH coverage needs `.mosaic()` across every tile that
intersects the boundary for that year, not `.first()` like
population_raster.py's single global image.
"""

from functools import lru_cache

import ee

import earth_engine

COLLECTION_ID = "projects/sat-io/open-datasets/landcover/ESRI_Global-LULC_10m_TS"
BAND = "b1"

MIN_YEAR = 2017
MAX_YEAR = 2025

# Esri/Impact Observatory's own 9-class scheme and palette, values 1-9 in
# the raw band -- see the catalog page cited above. One deliberate
# deviation from their official palette: Snow/ice was F2FAFF, an
# off-white nearly identical to Bare ground's EDE9E4 and Clouds' C8C8C8
# -- indistinguishable at a glance in a mountain region where all three
# classes are common. Swapped for a vivid, unmistakably icy cyan instead.
CLASSES = [
    {"value": 1, "name": "Water", "color": "1A5BAB"},
    {"value": 2, "name": "Trees", "color": "358221"},
    {"value": 3, "name": "Flooded vegetation", "color": "87D19E"},
    {"value": 4, "name": "Crops", "color": "FFDB5C"},
    {"value": 5, "name": "Built area", "color": "ED022A"},
    {"value": 6, "name": "Bare ground", "color": "EDE9E4"},
    {"value": 7, "name": "Snow/ice", "color": "4DD9FF"},
    {"value": 8, "name": "Clouds", "color": "C8C8C8"},
    {"value": 9, "name": "Rangeland", "color": "C6AD8D"},
]

VIS_PARAMS = {
    "min": 1,
    "max": 9,
    "palette": [c["color"] for c in CLASSES],
}


class LandcoverUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


class LandcoverYearInvalid(ValueError):
    """Raised for a year outside MIN_YEAR-MAX_YEAR."""


@lru_cache(maxsize=16)
def get_tile(year: int = MAX_YEAR):
    """Live XYZ tile URL for one year's land cover, clipped to the HKH
    region. Cached in-process per year since each call is a real Earth
    Engine round trip."""
    if not (MIN_YEAR <= year <= MAX_YEAR):
        raise LandcoverYearInvalid(f"year must be {MIN_YEAR}-{MAX_YEAR}")

    try:
        earth_engine.ensure_init()
        boundary = earth_engine.boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise LandcoverUnavailable(str(exc)) from exc

    mosaic = (
        ee.ImageCollection(COLLECTION_ID)
        .filterDate(f"{year}-01-01", f"{year + 1}-01-01")
        .select(BAND)
        .mosaic()
    )
    clipped = mosaic.clip(boundary)

    map_id = clipped.getMapId(VIS_PARAMS)
    return {"tileUrlTemplate": map_id["tile_fetcher"].url_format, "year": year}
