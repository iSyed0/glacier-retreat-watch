"""
Shared Google Earth Engine service-account setup. Used by era5_annual.py
(annual temperature), landcover.py (land cover), population_raster.py
(population density), and trends.py (temperature series for the Trends+
charts) -- factored out here once a second EE-backed raster needed the
same init/boundary logic.
"""

from pathlib import Path

import ee

# live-integration@ is native to endless-gamma-379613 -- the same project
# that owns both HKH boundary assets below -- so it reaches them (and every
# public dataset this app uses) with no separate per-asset sharing step.
# Replaced the original portal@my-project-3191-1760691930746 account,
# which needed HKH/hkh_bda explicitly shared with it; verified this one
# can reach everything the old one could before switching.
SERVICE_ACCOUNT = "live-integration@endless-gamma-379613.iam.gserviceaccount.com"
KEY_FILE = Path.home() / ".gcp-keys" / "endless-gamma-379613-38aec292d1b4.json"
PROJECT_ID = "endless-gamma-379613"

# HKH study area boundary (actual region outline, not just a bounding box) --
# same asset shown on the frontend map.
BOUNDARY_ASSET_ID = "projects/endless-gamma-379613/assets/HKH"

# A separate, more detailed HKH outline (table asset ingested directly into
# the endless-gamma-379613 project) used by the annual temperature layer
# (era5_annual.py) -- kept distinct from BOUNDARY_ASSET_ID rather than
# swapped in for it, since nothing else has been asked to move off the
# original boundary.
HKH_BDA_ASSET_ID = "projects/endless-gamma-379613/assets/hkh_bda"

# Public country-boundary dataset (LSIB) used to clip the HKH boundary down
# to one country's portion of it -- e.g. the Pakistan-only trend endpoint.
# Only the country names this app actually needs a clipped boundary for.
COUNTRY_LSIB_NAMES = {"PK": "Pakistan"}

_initialized = False


class EarthEngineUnavailable(RuntimeError):
    """Raised when Earth Engine can't be reached or isn't configured."""


def ensure_init():
    global _initialized
    if _initialized:
        return
    if not KEY_FILE.exists():
        raise EarthEngineUnavailable(f"Service account key not found at {KEY_FILE}")
    try:
        credentials = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, str(KEY_FILE))
        ee.Initialize(credentials, project=PROJECT_ID)
    except Exception as exc:  # noqa: BLE001 -- surface any EE/auth failure uniformly
        raise EarthEngineUnavailable(str(exc)) from exc
    _initialized = True


def boundary_geometry(country=None):
    """The HKH boundary, or (if `country` is given) just the portion of it
    that falls inside that country -- e.g. country="PK" for the Pakistan
    slice of the HKH region used by the Pakistan-scoped trend endpoint."""
    ensure_init()
    hkh = ee.FeatureCollection(BOUNDARY_ASSET_ID).geometry()
    if country is None:
        return hkh
    country_name = COUNTRY_LSIB_NAMES.get(country)
    if not country_name:
        raise ValueError(f"Unsupported country code: {country}")
    country_geom = ee.FeatureCollection("USDOS/LSIB_SIMPLE/2017").filter(
        ee.Filter.eq("country_na", country_name)
    ).geometry()
    return hkh.intersection(country_geom, ee.ErrorMargin(1000))


def bda_boundary_geometry():
    """The alternate HKH_BDA_ASSET_ID boundary -- see its comment above."""
    ensure_init()
    return ee.FeatureCollection(HKH_BDA_ASSET_ID).geometry()
