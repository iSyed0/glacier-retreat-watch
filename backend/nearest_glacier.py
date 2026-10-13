"""
Nearest-neighbor lookup over glaciers.geojson -- backs TerrainView.jsx's
two-stop fly animation (retreating glacier -> its nearest balanced
neighbor), the real version of the divergence phenomenon discussed and
saved for the user's presentation (avalanche nourishment / debris
insulation / aspect differences letting one glacier stay balanced right
next to retreating ones).

A plain linear scan over ~38,781 points with haversine distance is cheap
enough for an on-demand single lookup (a few milliseconds), so this
doesn't need an index -- just loaded once and cached in-process.
"""

import json
import math
from functools import lru_cache
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
GLACIERS_FILE = DATA_DIR / "glaciers.geojson"

EARTH_RADIUS_KM = 6371.0


@lru_cache(maxsize=1)
def _load_points():
    with open(GLACIERS_FILE, encoding="utf-8") as f:
        gj = json.load(f)
    points = []
    for feat in gj["features"]:
        p = feat["properties"]
        lon, lat = feat["geometry"]["coordinates"]
        points.append(
            {
                "lon": lon,
                "lat": lat,
                "id": p.get("id"),
                "ref": p.get("ref"),
                "name": p.get("name"),
                "country": p.get("country"),
                "trend": p.get("trend"),
                "rate": p.get("rate"),
                "area": p.get("area"),
            }
        )
    return points


def _haversine_km(lon1, lat1, lon2, lat2):
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def find_nearest(lon: float, lat: float, trend: int, max_km: float = 50.0, min_km: float = 0.01):
    """The closest glacier with the given `trend` (-1 retreating, 1
    balanced, 0 no significant trend) to (lon, lat), excluding points
    closer than `min_km` (the query point itself), within `max_km`. None
    if nothing qualifies within range."""
    best = None
    best_dist = None
    for p in _load_points():
        if p["trend"] != trend:
            continue
        dist = _haversine_km(lon, lat, p["lon"], p["lat"])
        if dist < min_km or dist > max_km:
            continue
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best = p
    if best is None:
        return None
    return {**best, "distanceKm": best_dist}
