"""
Point elevation lookups for the temperature/elevation hover toggle --
Copernicus GLO-30 DEM (~30m resolution), the same DEM source (COPDEM30)
the RGI7 glacier inventory's own metadata already uses, so hover elevation
is consistent with the dem_source implicit in the glacier dataset rather
than introducing a second, different elevation reference.

COPERNICUS/DEM/GLO30 is deprecated in favor of GLO30_2024_1 (same data,
newer ingestion) -- verified both return identical values at a live test
point, used the non-deprecated one since the deprecated one isn't
guaranteed to keep working.
"""

from functools import lru_cache

import ee

import earth_engine

COLLECTION_ID = "COPERNICUS/DEM/GLO30_2024_1"
BAND = "DEM"

# Snap hover coordinates to the DEM's own ~30m pixel grid before querying,
# so repeatedly hovering the same pixel hits the in-process cache instead
# of a fresh Earth Engine round trip every time. 30m is small enough that
# this snapping is imperceptible at any zoom level a user would hover at.
GRID_DEG = 30 / 111320  # ~30m in degrees (111.32km per degree of latitude)


class ElevationUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


def _snap(value: float, step: float) -> float:
    return round(value / step) * step


@lru_cache(maxsize=4096)
def _point_elevation_m(snapped_lon: float, snapped_lat: float):
    try:
        earth_engine.ensure_init()
    except earth_engine.EarthEngineUnavailable as exc:
        raise ElevationUnavailable(str(exc)) from exc

    image = ee.ImageCollection(COLLECTION_ID).select(BAND).mosaic()
    point = ee.Geometry.Point([snapped_lon, snapped_lat])
    return image.reduceRegion(
        reducer=ee.Reducer.first(), geometry=point, scale=30
    ).get(BAND).getInfo()


def get_point_elevation(lon: float, lat: float):
    """Elevation in metres at (lon, lat), or None over nodata (e.g. open
    ocean gaps in the DEM)."""
    return _point_elevation_m(_snap(lon, GRID_DEG), _snap(lat, GRID_DEG))
