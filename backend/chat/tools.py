"""
Data lookups ("queries") the chatbot's model can ask for. The model never
produces numbers itself -- it names a query, this module runs it against
the real datasets, and the result is rendered to the user as structured
blocks (stats / table / text) by ChatPanel.jsx.

Every query returns:
    {"summary": "<one line, fed back as conversation history>",
     "blocks":  [ {type: "stats"|"table"|"text", ...}, ... ]  (glacier tables
                 carry "features", one per row, so rows are clickable),
     "glacier": <GeoJSON feature of the best match, if any -- lets a
                 "glacier"/"terrain" action in the same plan target it>}
"""

import json
import math
import re
from functools import lru_cache
from pathlib import Path

import era5_annual
import elevation
import nearest_glacier
import trends

BACKEND_DIR = Path(__file__).resolve().parent.parent
GLACIERS_FILE = BACKEND_DIR / "data" / "glaciers.geojson"
SENSORS_DIR = BACKEND_DIR.parent / "sensors"
SENSOR_FILES = {
    "glof2": "glof2.geojson",
    "glof2_damaged": "glof2damagedstations.geojson",
    "bri_ff": "bri_ff.geojson",
    "focus2026": "focus2026.geojson",
    "gmrc_wapda": "gmrcwapda.geojson",
}
SENSOR_LABELS = {
    "glof2": "GLOF-II stations",
    "glof2_damaged": "GLOF-II damaged stations",
    "bri_ff": "BRI flash-flood sensors",
    "focus2026": "FOCUS 2026 stations",
    "gmrc_wapda": "GMRC/WAPDA stations",
}
TREND_LABELS = {-1: "Retreating", 0: "No significant trend", 1: "Balanced"}
MAX_ROWS = 10


class QueryError(Exception):
    """Bad arguments from the model -- shown to the user, not a crash."""


@lru_cache(maxsize=1)
def _features():
    with open(GLACIERS_FILE, encoding="utf-8") as f:
        return json.load(f)["features"]


@lru_cache(maxsize=1)
def _by_id():
    return {str(f["properties"]["id"]): f for f in _features()}


def get_feature(glacier_id):
    return _by_id().get(str(glacier_id))


# ---------------------------------------------------------------- helpers


def _num(v, name, lo=None, hi=None):
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise QueryError(f"{name} must be a number")
    if (lo is not None and x < lo) or (hi is not None and x > hi):
        raise QueryError(f"{name} must be between {lo} and {hi}")
    return x


def _trend(v):
    if v in (None, "", "any", "all"):
        return None
    if isinstance(v, str):
        v = {"retreating": -1, "stable": 0, "balanced": 1}.get(v.lower(), v)
    try:
        t = int(v)
    except (TypeError, ValueError):
        raise QueryError("trend must be -1, 0 or 1")
    if t not in TREND_LABELS:
        raise QueryError("trend must be -1, 0 or 1")
    return t


def _country(v):
    return v.upper() if isinstance(v, str) and v.strip() and v.lower() not in ("any", "all", "hkh") else None


def _name(props):
    n = props.get("name")
    return n if n and n != "null" else None


def _fmt(x, digits=2, unit=""):
    if x is None:
        return "—"
    return f"{x:,.{digits}f}{unit}"


def _filtered(country=None, trend=None):
    for f in _features():
        p = f["properties"]
        if country and p.get("country") != country:
            continue
        if trend is not None and p.get("trend") != trend:
            continue
        yield f


def _glacier_row(f, names):
    p = f["properties"]
    return [
        _name(p) or p.get("ref") or p.get("id"),
        names.get(p.get("country"), p.get("country")),
        TREND_LABELS.get(p.get("trend"), "—"),
        _fmt(p.get("rate"), 2, " m/yr"),
        _fmt(p.get("area"), 2, " km²"),
    ]


GLACIER_COLUMNS = ["Glacier", "Country", "Trend", "Rate", "Area"]


# ---------------------------------------------------------------- queries


def q_stats(args, names):
    country, trend = _country(args.get("country")), _trend(args.get("trend"))
    rows = list(_filtered(country, trend))
    if not rows:
        raise QueryError("No glaciers match those filters.")
    by_trend = {t: 0 for t in TREND_LABELS}
    area_sum = weighted = rated_area = 0.0
    named = 0
    for f in rows:
        p = f["properties"]
        by_trend[p.get("trend")] = by_trend.get(p.get("trend"), 0) + 1
        area = p.get("area") or 0.0
        area_sum += area
        if p.get("rate") is not None and area:
            weighted += p["rate"] * area
            rated_area += area
        named += 1 if _name(p) else 0
    scope = names.get(country, country) if country else "HKH region"
    if trend is not None:
        scope += f", {TREND_LABELS[trend].lower()}"
    items = [
        {"label": "Glaciers", "value": f"{len(rows):,}"},
        {"label": "Total area", "value": _fmt(area_sum, 0, " km²")},
        {"label": "Area-weighted rate", "value": _fmt(weighted / rated_area if rated_area else None, 2, " m/yr")},
        {"label": "Named", "value": f"{named:,}"},
    ]
    if trend is None:
        items += [{"label": TREND_LABELS[t], "value": f"{by_trend[t]:,} ({by_trend[t] / len(rows):.0%})"} for t in (-1, 0, 1)]
    summary = f"{scope}: {len(rows):,} glaciers, " + ", ".join(
        f"{TREND_LABELS[t].lower()} {by_trend[t]:,}" for t in (-1, 0, 1) if trend is None or t == trend
    )
    return {"summary": summary, "blocks": [{"type": "stats", "title": scope, "items": items}]}


SORTS = {
    "fastest_retreat": (lambda p: p.get("rate") if p.get("rate") is not None else math.inf, False),
    "fastest_gain": (lambda p: p.get("rate") if p.get("rate") is not None else -math.inf, True),
    "largest": (lambda p: p.get("area") or 0.0, True),
}


def q_search(args, names):
    text = str(args.get("name") or args.get("text") or "").strip()
    if text.lower() in ("largest", "biggest", "fastest", "fastest_retreat", "fastest_gain", "any", "all"):
        text = ""
    country, trend = _country(args.get("country")), _trend(args.get("trend"))
    sort = args.get("sort") or ("largest" if not text else None)
    if sort and sort not in SORTS:
        raise QueryError(f"sort must be one of {', '.join(SORTS)}")
    limit = int(_num(args.get("limit", 5), "limit", 1, MAX_ROWS))

    matches = list(_filtered(country, trend))
    if text:
        needle = re.sub(r"\bglaciers?\b", "", text, flags=re.I).strip().lower() or text.lower()
        exact = [f for f in matches if needle in (str(f["properties"].get("id")).lower(), (f["properties"].get("ref") or "").lower())]
        matches = exact or [
            f for f in matches
            if needle in (_name(f["properties"]) or "").lower() or needle in (f["properties"].get("ref") or "").lower()
        ]
    if sort:
        key, reverse = SORTS[sort]
        matches.sort(key=lambda f: key(f["properties"]), reverse=reverse)
    elif text:
        # Name hits first, larger glaciers first among equals.
        matches.sort(key=lambda f: (_name(f["properties"]) is None, -(f["properties"].get("area") or 0)))
    if not matches:
        raise QueryError(f"No glaciers found{f' matching “{text}”' if text else ''}.")

    top = matches[:limit]
    title = f"{len(matches):,} match{'es' if len(matches) != 1 else ''}" + (f", top {len(top)}" if len(matches) > len(top) else "")
    block = {
        "type": "table", "title": title, "columns": GLACIER_COLUMNS,
        "rows": [_glacier_row(f, names) for f in top],
        "features": top,  # clicking a row opens that glacier (ChatPanel.jsx)
    }
    first = top[0]["properties"]
    summary = f"search found {len(matches):,}; top: {_name(first) or first.get('ref')} (id {first['id']}, rate {_fmt(first.get('rate'))} m/yr)"
    return {"summary": summary, "blocks": [block], "glacier": top[0]}


def q_glacier(args, names):
    f = get_feature(args.get("id"))
    if f is None:
        return q_search({"text": str(args.get("id", "")), "limit": 1}, names)
    p = f["properties"]
    lon, lat = f["geometry"]["coordinates"]
    title = _name(p) or p.get("ref") or p["id"]
    items = [
        {"label": "Country", "value": names.get(p.get("country"), p.get("country") or "—")},
        {"label": "Trend", "value": TREND_LABELS.get(p.get("trend"), "—")},
        {"label": "Rate (1999-2019)", "value": _fmt(p.get("rate"), 2, " m/yr")},
        {"label": "Area", "value": _fmt(p.get("area"), 2, " km²")},
        {"label": "Location", "value": f"{lat:.3f}°N, {lon:.3f}°E"},
    ]
    recent = p.get("pRecent") or []
    if recent and recent[0][2] is not None:
        start, end, change = recent[0][:3]
        items.append({"label": f"Change {start}-{end}", "value": _fmt(change, 2, " m")})
    return {"summary": f"{title}: {TREND_LABELS.get(p.get('trend'))}, rate {_fmt(p.get('rate'))} m/yr", "blocks": [{"type": "stats", "title": title, "items": items}], "glacier": f}


def q_point(args, names):
    lon = _num(args.get("lon"), "lon", -180, 180)
    lat = _num(args.get("lat"), "lat", -90, 90)
    year = int(_num(args.get("year", era5_annual.MAX_YEAR), "year", era5_annual.MIN_YEAR, era5_annual.MAX_YEAR))
    try:
        temp = era5_annual.get_point_temp(lon, lat, year)
    except era5_annual.Era5AnnualUnavailable:
        temp = None
    try:
        elev = elevation.get_point_elevation(lon, lat)
    except elevation.ElevationUnavailable:
        elev = None
    items = [
        {"label": f"Mean temperature {year}", "value": _fmt(temp, 1, " °C")},
        {"label": "Elevation", "value": _fmt(elev, 0, " m")},
    ]
    return {
        "summary": f"at {lat:.3f},{lon:.3f}: {_fmt(temp, 1)} °C in {year}, elevation {_fmt(elev, 0)} m",
        "blocks": [{"type": "stats", "title": f"{lat:.3f}°N, {lon:.3f}°E", "items": items}],
    }


def q_nearest(args, names):
    lon = _num(args.get("lon"), "lon", -180, 180)
    lat = _num(args.get("lat"), "lat", -90, 90)
    trend = _trend(args.get("trend"))
    if trend is None:
        raise QueryError("nearest needs a trend (-1, 0 or 1)")
    max_km = _num(args.get("max_km", 50), "max_km", 1, 500)
    hit = nearest_glacier.find_nearest(lon, lat, trend, max_km=max_km)
    if hit is None:
        raise QueryError(f"No {TREND_LABELS[trend].lower()} glacier within {max_km:.0f} km.")
    f = get_feature(hit["id"])
    block = {
        "type": "table", "title": f"Nearest {TREND_LABELS[trend].lower()} glacier ({hit['distanceKm']:.1f} km away)",
        "columns": GLACIER_COLUMNS, "rows": [_glacier_row(f, names)], "features": [f],
    }
    return {"summary": f"nearest {TREND_LABELS[trend].lower()}: id {hit['id']} at {hit['distanceKm']:.1f} km", "blocks": [block], "glacier": f}


def q_trends(args, names):
    region = (args.get("region") or "hkh").lower()
    country = "PK" if region in ("pk", "pakistan") else None
    note = None
    try:
        series = trends.get_trends(country=country)
    except trends.TrendsUnavailable:
        series = trends.get_glacier_trend(country)  # local-only fallback, no temperature
        note = "Earth Engine unavailable -- temperatures omitted."
    rows = [
        [f"{s['startYear']}-{s['endYear']}", _fmt(s["elevationChangeRateM"], 3, " m/yr"),
         _fmt(s["specificMassBalanceMWeYr"], 3, " m w.e./yr"), _fmt(s.get("meanTempC"), 2, " °C"), f"{s['glacierCount']:,}"]
        for s in series
    ]
    label = "Pakistan" if country else "HKH region"
    blocks = [{"type": "table", "title": f"Glacier change vs temperature — {label}",
               "columns": ["Period", "Elevation change", "Mass balance", "Mean temp", "Glaciers"], "rows": rows}]
    if note:
        blocks.append({"type": "text", "text": note})
    rates = [s["elevationChangeRateM"] for s in series if s["elevationChangeRateM"] is not None]
    return {"summary": f"{label} trends over {len(rows)} periods, rate {_fmt(min(rates))} to {_fmt(max(rates))} m/yr" if rates else f"{label} trends", "blocks": blocks}


def q_sensors(args, names):
    key = (args.get("network") or "").lower().replace("-", "_")
    if key not in SENSOR_FILES:
        raise QueryError(f"network must be one of {', '.join(SENSOR_FILES)}")
    path = SENSORS_DIR / SENSOR_FILES[key]
    if not path.exists():
        raise QueryError(f"{SENSOR_LABELS[key]} file isn't available.")
    feats = json.loads(path.read_text(encoding="utf-8"))["features"]
    # Each network has its own schema -- show whichever of these columns it has.
    wanted = ["StationNam", "Name", "name", "Station", "District", "Province", "Status", "Elev"]
    keys = [k for k in wanted if any(k in f["properties"] for f in feats)][:4]
    rows = [[str(f["properties"].get(k, "—")) for k in keys] for f in feats[:MAX_ROWS]]
    blocks = [{"type": "stats", "title": SENSOR_LABELS[key], "items": [{"label": "Stations", "value": f"{len(feats):,}"}]}]
    if keys:
        blocks.append({"type": "table", "title": f"First {len(rows)}", "columns": keys, "rows": rows})
    return {"summary": f"{SENSOR_LABELS[key]}: {len(feats)} stations", "blocks": blocks}


QUERIES = {
    "stats": q_stats,
    "search": q_search,
    "glacier": q_glacier,
    "point": q_point,
    "nearest": q_nearest,
    "trends": q_trends,
    "sensors": q_sensors,
}


def run_query(q, names):
    fn = QUERIES.get(q.get("q"))
    if fn is None:
        raise QueryError(f"Unknown query “{q.get('q')}”.")
    return fn(q, names)
