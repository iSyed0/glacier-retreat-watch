"""
On-demand ERA5 monthly air-temperature tiles for the HKH region.

Talks to Google Earth Engine using a service account, so the frontend can
ask for any month in the record and get back a live XYZ tile URL -- rather
than being stuck with one tile baked in at build time.
"""

from functools import lru_cache

import ee

import earth_engine

COLLECTION_ID = "ECMWF/ERA5/MONTHLY"
BAND = "mean_2m_air_temperature"

VIS_PARAMS = {
    "bands": [BAND],
    "min": 250.0,
    "max": 320.0,
    "palette": [
        "000080", "0000d9", "4000ff", "8000ff", "0080ff", "00ffff",
        "00ff80", "80ff00", "daff00", "ffff00", "fff500", "ffda00",
        "ffb000", "ffa400", "ff4f00", "ff2500", "ff0a00", "ff00ff",
    ],
}


class Era5Unavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


def _collection():
    try:
        earth_engine.ensure_init()
    except earth_engine.EarthEngineUnavailable as exc:
        raise Era5Unavailable(str(exc)) from exc
    return ee.ImageCollection(COLLECTION_ID)


def _boundary_geometry():
    try:
        return earth_engine.boundary_geometry()
    except earth_engine.EarthEngineUnavailable as exc:
        raise Era5Unavailable(str(exc)) from exc


@lru_cache(maxsize=1)
def get_date_range():
    """The earliest and latest months actually present in the collection."""
    coll = _collection()
    first = coll.sort("system:time_start").first()
    last = coll.sort("system:time_start", False).first()
    return {
        "min": first.date().format("YYYY-MM").getInfo(),
        "max": last.date().format("YYYY-MM").getInfo(),
    }


@lru_cache(maxsize=512)
def get_tile_for_month(year: int, month: int):
    """Live XYZ tile URL for one calendar month, clipped to the HKH region.

    Returns None if the collection has no image for that month. Results are
    cached in-process (cleared on server restart) since each call is a real
    Earth Engine round trip.
    """
    coll = _collection()
    start = ee.Date.fromYMD(year, month, 1)
    end = start.advance(1, "month")
    filtered = coll.filterDate(start, end)

    if filtered.size().getInfo() == 0:
        return None

    image = filtered.first()
    clipped = image.clip(_boundary_geometry())

    map_id = clipped.getMapId(VIS_PARAMS)
    actual_date = image.date().format("YYYY-MM").getInfo()

    return {
        "tileUrlTemplate": map_id["tile_fetcher"].url_format,
        "date": actual_date,
    }
