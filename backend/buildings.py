"""
Building footprints -- served by an internal TileServer GL instance (one
vector tileset per Pakistani district, generated from IAPD building
footprint data). We don't proxy the actual tiles; the frontend talks to the
tile server directly (it already sends permissive CORS headers) using URLs
built from the district ids this module hands back.
"""

import os
from functools import lru_cache

import requests
#139 153
TILESERVER_URL = os.environ.get("BUILDINGS_TILESERVER_URL", "http://172.18.1.150:8081")


class BuildingsUnavailable(RuntimeError):
    """Raised when the tile server can't be reached."""


@lru_cache(maxsize=1)
def get_index():
    """One entry per district: {id, bounds}.

    The tile server's own index.json carries a lot of tippecanoe/tilestats
    metadata we don't need (a few MB across ~160 districts) -- trimmed down
    here to just what the frontend needs to add each vector source. Cached
    in-process since the dataset list doesn't change at runtime; restart the
    backend if districts are added/removed on the tile server.
    """
    try:
        resp = requests.get(f"{TILESERVER_URL}/index.json", timeout=10)
        resp.raise_for_status()
    except requests.RequestException as exc:
        raise BuildingsUnavailable(str(exc)) from exc

    return [{"id": item["id"], "bounds": item["bounds"]} for item in resp.json()]
