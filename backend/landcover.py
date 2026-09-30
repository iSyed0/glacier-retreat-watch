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

# RGI7 glacier outlines (274,531 features globally; ~76,800 intersect the
# HKH boundary) -- the authoritative spatial reference used to correct the
# raw ESRI classification below. Deliberately NOT elevation-based: the
# outlines are the only thing allowed to say "this pixel is a glacier."
RGI_COLLECTION_ID = "projects/sat-io/open-datasets/RGI/RGI_VECTOR_MERGED_V7"

MIN_YEAR = 2017
MAX_YEAR = 2025

SNOW_ICE_VALUE = 7
# Last-resort value for a false-positive Snow/ice pixel whose fallback (see
# _corrected_mosaic) is itself undefined -- i.e. it was classified Snow/ice
# in literally every year of the time series, so there's no non-snow vote
# to fall back to. Bare ground is the neutral default for that edge case.
FALLBACK_DEFAULT_VALUE = 6

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


def _year_mosaic(collection, year, boundary):
    return (
        collection.filterDate(f"{year}-01-01", f"{year + 1}-01-01")
        .select(BAND)
        .mosaic()
        .clip(boundary)
    )


def _corrected_mosaic(year, boundary):
    """The raw ESRI classification for `year`, with the Snow/ice class
    (7) spatially constrained to RGI7 glacier outlines instead of
    whatever ESRI's own per-pixel guess was:

    - Inside an RGI glacier polygon: always Snow/ice, even if ESRI's
      classifier missed it that year.
    - Outside an RGI polygon: Snow/ice is never allowed. A pixel ESRI
      called Snow/ice here is a false positive (e.g. a lowland area like
      Mardan catching a snowy-looking scene one year) and is replaced by
      that pixel's most common *non*-snow classification across the rest
      of the 2017-2025 time series -- excluding each year's own Snow/ice
      votes so the fallback can't itself come back as Snow/ice.
    - Everywhere else: ESRI's original classification, untouched.
    """
    collection = ee.ImageCollection(COLLECTION_ID)
    original = _year_mosaic(collection, year, boundary)

    rgi = ee.FeatureCollection(RGI_COLLECTION_ID).filterBounds(boundary)
    glacier_mask = ee.Image().byte().paint(rgi, 1).clip(boundary).unmask(0)

    non_snow_years = []
    for other_year in range(MIN_YEAR, MAX_YEAR + 1):
        yearly = _year_mosaic(collection, other_year, boundary)
        non_snow_years.append(yearly.updateMask(yearly.neq(SNOW_ICE_VALUE)))
    fallback = (
        ee.ImageCollection(non_snow_years)
        .reduce(ee.Reducer.mode())
        .unmask(FALLBACK_DEFAULT_VALUE)
    )

    false_positive = glacier_mask.eq(0).And(original.eq(SNOW_ICE_VALUE))

    return (
        original.where(false_positive, fallback)
        .where(glacier_mask.eq(1), SNOW_ICE_VALUE)
    )


@lru_cache(maxsize=16)
def get_tile(year: int = MAX_YEAR):
    """Live XYZ tile URL for one year's land cover, clipped to the HKH
    region, with the Snow/ice class corrected against RGI7 glacier
    outlines (see _corrected_mosaic). Cached in-process per year since
    each call is a real Earth Engine round trip."""
    if not (MIN_YEAR <= year <= MAX_YEAR):
        raise LandcoverYearInvalid(f"year must be {MIN_YEAR}-{MAX_YEAR}")

    try:
        earth_engine.ensure_init()
        boundary = earth_engine.boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise LandcoverUnavailable(str(exc)) from exc

    corrected = _corrected_mosaic(year, boundary)

    map_id = corrected.getMapId(VIS_PARAMS)
    return {"tileUrlTemplate": map_id["tile_fetcher"].url_format, "year": year}
