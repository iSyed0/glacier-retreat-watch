"""
ESA WorldCover v200 (2021), HKH-cropped, live from Google Earth Engine --
same service account as era5_annual.py/population_raster.py, via the
shared earth_engine module. A single global snapshot (v200 is the one
and only 2021 edition, no time series), so this always serves that one
image -- same "no year parameter" shape as population_raster.py.

This is a separate dataset from landcover.py's Esri/Impact Observatory
Sentinel-2 layer -- different source, different classification scheme,
kept as its own module/layer rather than merged into that one.
"""

from functools import lru_cache

import ee

import earth_engine

COLLECTION_ID = "ESA/WorldCover/v200"
BAND = "Map"

# ESA's own 11-class scheme and palette, values 10-100 in the raw band --
# read directly off the image's own Map_class_values/_names/_palette
# properties and confirmed correct, rather than hardcoded from memory.
# One deliberate deviation from their official palette: Snow and ice was
# f0f0f0, a light gray too close to Bare/sparse vegetation's b4b4b4 to
# tell apart at a glance in a mountain region where both are common.
# Swapped for a vivid, unmistakably icy cyan instead (same color used
# for landcover.py's Snow/ice class, for consistency between the two
# land cover layers).
CLASSES = [
    {"value": 10, "name": "Tree cover", "color": "006400"},
    {"value": 20, "name": "Shrubland", "color": "ffbb22"},
    {"value": 30, "name": "Grassland", "color": "ffff4c"},
    {"value": 40, "name": "Cropland", "color": "f096ff"},
    {"value": 50, "name": "Built-up", "color": "fa0000"},
    {"value": 60, "name": "Bare / sparse vegetation", "color": "b4b4b4"},
    {"value": 70, "name": "Snow and ice", "color": "4DD9FF"},
    {"value": 80, "name": "Permanent water bodies", "color": "0064c8"},
    {"value": 90, "name": "Herbaceous wetland", "color": "0096a0"},
    {"value": 95, "name": "Mangroves", "color": "00cf75"},
    {"value": 100, "name": "Moss and lichen", "color": "fae6a0"},
]

VIS_PARAMS = {
    "bands": [BAND],
    "min": CLASSES[0]["value"],
    "max": CLASSES[-1]["value"],
    "palette": [c["color"] for c in CLASSES],
}


class LandcoverEsaUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


@lru_cache(maxsize=1)
def get_tile():
    """Live XYZ tile URL for ESA WorldCover, clipped to the HKH_BDA
    boundary (the same one the user verified this against in the GEE
    Code Editor). Cached in-process -- there's only ever one snapshot."""
    try:
        earth_engine.ensure_init()
        boundary = earth_engine.bda_boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise LandcoverEsaUnavailable(str(exc)) from exc

    image = ee.ImageCollection(COLLECTION_ID).first().select(BAND)
    clipped = image.clip(boundary)
    map_id = clipped.getMapId(VIS_PARAMS)
    return {"tileUrlTemplate": map_id["tile_fetcher"].url_format}
