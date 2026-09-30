"""
HKH Glacier Watch -- backend API.

Serves the glacier point dataset and app configuration to the React frontend,
and (in production) serves the built frontend static files too, so a single
process/port runs the whole app.
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import buildings
import era5_annual
import landcover
import landcover_esa
import population_raster
import trends

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

GLACIERS_FILE = DATA_DIR / "glaciers.geojson"
BOUNDARY_FILE = DATA_DIR / "hkh_boundary.geojson"

# Pakistan admin boundaries. The districts layer is served pre-simplified
# (mapshaper) since the source file is ~300MB of survey-grade vertex
# density, far more detail than a web map can use -- the raw original is
# kept alongside it for provenance but isn't served.
PK_BOUNDARIES_DIR = BASE_DIR.parent / "boundaries"
PK_BOUNDARY_FILES = {
    "national": PK_BOUNDARIES_DIR / "Pakistan_National.geojson",
    "provinces": PK_BOUNDARIES_DIR / "Pakistan_Provinces.geojson",
    "districts": PK_BOUNDARIES_DIR / "Pakistan_Districts.simplified.geojson",
}

# Field sensor / monitoring-station networks (static point layers, no EE
# involved) -- each file has its own property schema, so the frontend reads
# whatever keys are present rather than this backend normalizing them.
SENSORS_DIR = BASE_DIR.parent / "sensors"
SENSOR_FILES = {
    "glof2": SENSORS_DIR / "glof2.geojson",
    "glof2-damaged": SENSORS_DIR / "glof2damagedstations.geojson",
    "bri-ff": SENSORS_DIR / "bri_ff.geojson",
    "focus2026": SENSORS_DIR / "focus2026.geojson",
    "gmrc-wapda": SENSORS_DIR / "gmrcwapda.geojson",
}

# River / canal / nalla network (polygon geometry -- river bodies, not
# centerlines). Source was a QGIS export wrapped in a `var rivers = ...`
# JS assignment; rivers.geojson here has already been unwrapped to plain
# GeoJSON (see rivers/rivers.qmd for the original QGIS layer metadata).
RIVERS_FILE = BASE_DIR.parent / "rivers" / "rivers.geojson"

# RGI 7.0's Hindu Kush Himalaya glaciated-region outline -- 3 O1 (first-
# order) region polygons (Central Asia, South Asia West, South Asia East)
# from the GTN-G region-boundary product RGI7 defines its regions against
# (see rgi7/SOURCE.md for provenance). A boundary of where RGI7 draws its
# regions, not individual glacier/complex outlines -- distinct from both
# BOUNDARY_FILE (this app's own HKH study-area outline) and the point
# glaciers in GLACIERS_FILE.
RGI7_HKH_REGIONS_FILE = BASE_DIR.parent / "rgi7" / "hkh_o1regions.geojson"

# Country codes referenced in the glacier dataset.
COUNTRY_NAMES = {
    "AF": "Afghanistan",
    "PK": "Pakistan",
    "IN": "India",
    "CN": "China",
    "NP": "Nepal",
    "BT": "Bhutan",
    "MM": "Myanmar",
    "TJ": "Tajikistan",
}

# Annual mean 2m air temperature, 1999-2026, ERA5-Land -- the year-slider
# layer ported from the GEE Code Editor script (see era5_annual.py). Static
# display config; the year range/tiles themselves come from
# /api/era5-annual/range and /api/era5-annual/tiles.
ERA5_ANNUAL_LAYER = {
    "attribution": "ERA5-Land (ECMWF) via Google Earth Engine",
    "minC": era5_annual.VIS_PARAMS["min"],
    "maxC": era5_annual.VIS_PARAMS["max"],
    "palette": era5_annual.VIS_PARAMS["palette"],
}

# Gridded population density, HKH-cropped -- a single 2020 snapshot (CIESIN
# GPWv4.11 only publishes one image per 5-year interval), so the static
# display config here doubles as everything the frontend needs.
POPULATION_RASTER_LAYER = {
    "attribution": "CIESIN GPWv4.11 (2020) via Google Earth Engine",
    "maxDensity": population_raster.MAX_DENSITY,
    "palette": population_raster.VIS_PARAMS["palette"],
}

# Two separate land cover layers, different sources/schemes -- named
# Esri/Esa throughout (config keys, endpoints) rather than a bare
# "landcover" now that there's more than one. Both are categorical (not
# a continuous gradient like ERA5/population), so the frontend renders
# class swatches for each rather than a gradient bar.
LANDCOVER_ESRI_LAYER = {
    "attribution": "Esri / Impact Observatory Sentinel-2 10m LULC (CC BY-4.0) via Google Earth Engine",
    "minYear": landcover.MIN_YEAR,
    "maxYear": landcover.MAX_YEAR,
    "classes": landcover.CLASSES,
}
LANDCOVER_ESA_LAYER = {
    "attribution": "ESA WorldCover v200 (2021) via Google Earth Engine",
    "classes": landcover_esa.CLASSES,
}

app = FastAPI(title="HKH Glacier Watch API")

# Allow the Vite dev server to call the API during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

# GeoJSON is very repetitive text (coordinate arrays, the same property
# keys over and over), so it compresses hard -- glaciers.geojson alone is
# ~15MB uncompressed. This cuts every response over 1KB, not just the
# GeoJSON ones, so the small JSON endpoints (trends, config, ...) get it
# too at negligible cost.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# These files only change when the backend is redeployed with freshly
# merged data (a manual step, not something that happens while the server
# is running), and several are large enough -- glaciers ~15MB, rivers
# ~9MB, the Pakistan boundaries ~4-6MB each -- that avoiding a re-fetch
# matters: MapView.jsx re-adds every overlay source on each basemap
# switch (see its comment on addOverlayLayers), so without this header,
# switching basemaps back and forth re-downloads all of them every time.
STATIC_GEOJSON_HEADERS = {"Cache-Control": "public, max-age=3600"}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/config")
def config():
    return {
        "countryNames": COUNTRY_NAMES,
        "era5Annual": ERA5_ANNUAL_LAYER,
        "populationRaster": POPULATION_RASTER_LAYER,
        "landcoverEsri": LANDCOVER_ESRI_LAYER,
        "landcoverEsa": LANDCOVER_ESA_LAYER,
        "mapCenter": [82.5, 32.0],
        "mapZoom": 2.5,
        # Bounding box of the HKH study area boundary (backend/data/hkh_boundary.geojson)
        # -- [[minLon, minLat], [maxLon, maxLat]] -- used by the "center on HKH
        # region" button to fitBounds() rather than a hand-picked center/zoom.
        "hkhBounds": [[60.85, 15.96], [105.05, 39.32]],
    }


@app.get("/api/glaciers")
def glaciers():
    # Served straight off disk -- it's a large static file and doesn't need
    # to be parsed/re-serialized on every request.
    return FileResponse(GLACIERS_FILE, media_type="application/geo+json", headers=STATIC_GEOJSON_HEADERS)


@app.get("/api/boundary")
def boundary():
    # HKH study area outline (projects/endless-gamma-379613/assets/HKH),
    # same geometry the ERA5 layer is clipped to -- served straight off disk.
    return FileResponse(BOUNDARY_FILE, media_type="application/geo+json", headers=STATIC_GEOJSON_HEADERS)


@app.get("/api/boundaries/pakistan/{level}")
def pakistan_boundary(level: str):
    """Pakistan admin boundary outline: level is 'national', 'provinces', or 'districts'."""
    path = PK_BOUNDARY_FILES.get(level)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Unknown boundary level: {level}")
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"Boundary file not available: {path.name}")
    return FileResponse(path, media_type="application/geo+json", headers=STATIC_GEOJSON_HEADERS)


@app.get("/api/sensors/{key}")
def sensor_layer(key: str):
    """One field sensor/monitoring-station network as GeoJSON points --
    key is one of SENSOR_FILES (see above)."""
    path = SENSOR_FILES.get(key)
    if path is None:
        raise HTTPException(status_code=404, detail=f"Unknown sensor layer: {key}")
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"Sensor file not available: {path.name}")
    return FileResponse(path, media_type="application/geo+json", headers=STATIC_GEOJSON_HEADERS)


@app.get("/api/rivers")
def rivers():
    """River / canal / nalla polygons (see RIVERS_FILE above) -- served
    straight off disk like the other static GeoJSON layers."""
    if not RIVERS_FILE.exists():
        raise HTTPException(status_code=503, detail=f"Rivers file not available: {RIVERS_FILE.name}")
    return FileResponse(RIVERS_FILE, media_type="application/geo+json", headers=STATIC_GEOJSON_HEADERS)


@app.get("/api/rgi7/hkh-regions")
def rgi7_hkh_regions():
    """RGI7's Hindu Kush Himalaya glaciated-region outline (see
    RGI7_HKH_REGIONS_FILE above) -- served straight off disk like the
    other static GeoJSON layers."""
    if not RGI7_HKH_REGIONS_FILE.exists():
        raise HTTPException(status_code=503, detail=f"RGI7 regions file not available: {RGI7_HKH_REGIONS_FILE.name}")
    return FileResponse(RGI7_HKH_REGIONS_FILE, media_type="application/geo+json", headers=STATIC_GEOJSON_HEADERS)


@app.get("/api/buildings/index")
def buildings_index():
    """District id + bounds for every building-footprint tileset on the
    internal tile server, plus the server's own base URL. The frontend
    builds each vector source from these: tiles at
    {tileServer}/data/{id}/{z}/{x}/{y}.pbf."""
    try:
        return {"tileServer": buildings.TILESERVER_URL, "districts": buildings.get_index()}
    except buildings.BuildingsUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Buildings tile server unavailable: {exc}")


@app.get("/api/population/raster")
def population_raster_tile():
    """Live XYZ tile URL for gridded population density (CIESIN GPWv4.11,
    log10-scaled), HKH-cropped. No parameters -- there's only one snapshot."""
    try:
        return population_raster.get_tile()
    except population_raster.PopulationRasterUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/landcover-esri/tile")
def landcover_esri_tile(year: int = landcover.MAX_YEAR):
    """Live XYZ tile URL for one year's Sentinel-2 10m land cover,
    HKH-cropped (mosaicked across every UTM tile covering the region --
    see landcover.py). Defaults to the most recent year."""
    try:
        return landcover.get_tile(year)
    except landcover.LandcoverYearInvalid as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except landcover.LandcoverUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/landcover-esa/tile")
def landcover_esa_tile():
    """Live XYZ tile URL for ESA WorldCover v200, HKH-cropped (see
    landcover_esa.py). No year parameter -- v200 is a single 2021
    snapshot, not a time series."""
    try:
        return landcover_esa.get_tile()
    except landcover_esa.LandcoverEsaUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/trends")
def glacier_temperature_trends():
    """Region-wide glacier elevation-change rate vs. mean temperature, one
    figure per 5-year period across the 1999-2019 record (see trends.py --
    that's the actual resolution the glacier data supports, not truly
    annual)."""
    try:
        return trends.get_trends()
    except trends.TrendsUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/trends/pk")
def glacier_temperature_trends_pakistan():
    """Same as /api/trends, scoped to glaciers inside Pakistan and to the
    Pakistan portion of the HKH boundary for the temperature series."""
    try:
        return trends.get_trends(country="PK")
    except trends.TrendsUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/mass-balance")
def glacier_mass_balance_trends():
    """Region-wide glacier mass-balance rate (Gt/yr, from summed volume
    change converted via a standard ice-density assumption) vs. mean
    temperature, same periods as /api/trends -- see trends.py."""
    try:
        return trends.get_mass_balance_trends()
    except trends.TrendsUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/mass-balance/pk")
def glacier_mass_balance_trends_pakistan():
    """Same as /api/mass-balance, scoped to glaciers inside Pakistan and to
    the Pakistan portion of the HKH boundary for the temperature series."""
    try:
        return trends.get_mass_balance_trends(country="PK")
    except trends.TrendsUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


@app.get("/api/era5-annual/range")
def era5_annual_range():
    """The earliest/latest years the annual temperature layer will query."""
    return era5_annual.get_year_range()


@app.get("/api/era5-annual/tiles")
def era5_annual_tiles():
    """Every year's tile in one response (see era5_annual.get_all_tiles) --
    the frontend fetches this once up front rather than one request per
    year as the slider moves, which was slow and race-prone enough
    per-year that playback visibly lagged and could momentarily show a
    year the user had already scrubbed past."""
    try:
        return era5_annual.get_all_tiles()
    except era5_annual.Era5AnnualUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Earth Engine unavailable: {exc}")


# In production, serve the built React app for everything else.
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
