"""
Shared Google Earth Engine service-account setup. Used by era5.py (monthly
temperature) and population_raster.py (population density) -- factored out
here once a second EE-backed raster needed the same init/boundary logic.
"""

from pathlib import Path

import ee

SERVICE_ACCOUNT = "portal@my-project-3191-1760691930746.iam.gserviceaccount.com"
KEY_FILE = Path.home() / ".gcp-keys" / "my-project-3191-1760691930746-feca44372dda.json"
PROJECT_ID = "my-project-3191-1760691930746"

# HKH study area boundary (actual region outline, not just a bounding box) --
# same asset shown on the frontend map. Shared read access was granted to
# the service account above.
BOUNDARY_ASSET_ID = "projects/endless-gamma-379613/assets/HKH"

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


def boundary_geometry():
    ensure_init()
    return ee.FeatureCollection(BOUNDARY_ASSET_ID).geometry()
