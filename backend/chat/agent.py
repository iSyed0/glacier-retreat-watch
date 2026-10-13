"""
One chatbot turn: ask the local model for a JSON plan, then validate its
actions and run its queries. Yields event dicts that app.py streams to the
browser as SSE:

    {"type": "status",   "stage": "loading"|"reading"|"writing"|"looking_up", "progress"?: 0-1}
    {"type": "reply",    "say": str, "actions": [...], "blocks": [...], "memory": str}
    {"type": "error",    "message": str}

Small models drift from the requested format, so everything the model
returns is treated as untrusted: unknown actions/layers are dropped, args
are coerced, and plain-text output falls back to a text-only reply.
"""

import json
import re

from . import lmstudio, tools
from .prompt import SYSTEM_PROMPT, build_input

LAYERS = {
    "boundary", "pk_national", "pk_provinces", "pk_districts", "buildings", "population",
    "landcover", "temperature", "rivers", "hover_info", "glof2", "glof2_damaged", "bri_ff",
    "focus2026", "gmrc_wapda",
}
OPACITY_LAYERS = {"temperature", "population", "landcover"}
BASEMAPS = {"satellite-streets", "streets", "outdoors", "light", "dark"}
CHARTS = {"trendsHkh", "trendsPk", "specificMassHkh", "specificMassPk"}
YEAR_MIN, YEAR_MAX = 1999, 2026
MAX_QUERIES = 3


STEP_KEYS = ("do", "a", "q", "action", "query")


PAIR_RE = re.compile(r'"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)')


def _extract_plan(text):
    """{"say", "steps"} from the model output, or None if nothing usable.

    Tolerates ```json fences and chatter around the JSON. When the JSON
    itself is broken -- a 2B model now and then copies choice notation
    ("a"|"b") or drops the braces around steps -- falls back to scanning
    every "key": value pair in order and starting a new step at each
    "do" key, which recovers the intent in practice."""
    text = re.sub(r"```(?:json)?", "", text)
    text = re.sub(r'("[^"]*")(?:\s*\|\s*"[^"]*")+', lambda m: m.group(1), text)  # "a"|"b"|"c" -> "a"
    text = re.sub(r'"(?:a|do|q)"\s*:\s*"q"\s*:', '"do":', text)  # {"a":"q":"stats"} -> {"do":"stats"}
    text = re.sub(r':\s*"(\w+)(?=[}\]])', lambda m: f':"{m.group(1)}"', text)  # {"do":"terrain} -> {"do":"terrain"}
    start = text.find("{")
    if start != -1:
        try:
            obj, _ = json.JSONDecoder().raw_decode(text[start:])
            if isinstance(obj, dict):
                return obj
        except ValueError:
            pass

    say, steps = "", []
    for key, raw in PAIR_RE.findall(text):
        value = json.loads(raw)
        if key == "say":
            say = value
        elif key in STEP_KEYS and isinstance(value, str):
            steps.append({"do": value})
        elif steps:
            steps[-1][key] = value
    return {"say": say, "steps": steps} if say or steps else None


def _as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def _bool(v):
    return v if isinstance(v, bool) else str(v).lower() not in ("false", "0", "off", "no", "hide")


def _clean_action(a):
    """Validated action dict, or None to drop it."""
    if not isinstance(a, dict):
        return None
    kind = _kind(a)
    if kind == "layer" and a.get("name") in LAYERS:
        return {"a": "layer", "name": a["name"], "on": _bool(a.get("on", True))}
    if kind == "opacity" and a.get("name") in OPACITY_LAYERS:
        try:
            return {"a": "opacity", "name": a["name"], "value": min(1.0, max(0.0, float(a.get("value"))))}
        except (TypeError, ValueError):
            return None
    if kind == "basemap" and a.get("style") in BASEMAPS:
        return {"a": "basemap", "style": a["style"]}
    if kind == "year":
        try:
            year = int(a.get("year"))
        except (TypeError, ValueError):
            return None
        return {"a": "year", "year": min(YEAR_MAX, max(YEAR_MIN, year))}
    if kind == "play":
        return {"a": "play", "on": _bool(a.get("on", True))}
    if kind == "fly":
        try:
            lon, lat = float(a.get("lon")), float(a.get("lat"))
            zoom = float(a.get("zoom", 8))
        except (TypeError, ValueError):
            return None
        if -180 <= lon <= 180 and -90 <= lat <= 90:
            return {"a": "fly", "lon": lon, "lat": lat, "zoom": min(16.0, max(1.0, zoom))}
        return None
    if kind in ("fit_hkh", "close"):
        return {"a": kind}
    if kind == "chart" and a.get("key") in CHARTS:
        return {"a": "chart", "key": a["key"]}
    if kind in ("open_glacier", "terrain"):
        return {"a": "glacier" if kind == "open_glacier" else "terrain", "id": a.get("id")}
    return None


def _kind(step):
    return next((step[k] for k in STEP_KEYS if isinstance(step.get(k), str)), None)


def run(message, history, ui_state, country_names):
    try:
        yield {"type": "status", "stage": "loading"}
        instance = lmstudio.ensure_instance()

        text = ""
        writing = False
        for event, data in lmstudio.chat_stream(instance, SYSTEM_PROMPT, build_input(message, history, ui_state)):
            if event == "model_load.progress":
                yield {"type": "status", "stage": "loading", "progress": data.get("progress")}
            elif event == "prompt_processing.progress":
                yield {"type": "status", "stage": "reading", "progress": data.get("progress")}
            elif event == "message.delta":
                text += data.get("content", "")
                if not writing:
                    writing = True
                    yield {"type": "status", "stage": "writing"}
            elif event == "error":
                err = data.get("error", {})
                raise lmstudio.LMStudioUnavailable(err.get("message") or "LM Studio returned an error")
    except lmstudio.LMStudioUnavailable as exc:
        yield {"type": "error", "message": str(exc)}
        return

    plan = _extract_plan(text)
    if plan is None:
        # Model ignored the format entirely. Show plain prose as-is, but never
        # a raw JSON fragment.
        say = text.strip()
        if not say or "{" in say:
            say = "Sorry, I couldn't work that out. Try rephrasing?"
        yield {"type": "reply", "say": say, "actions": [], "blocks": [], "memory": say}
        return

    say = str(plan.get("say") or "").strip()
    # Accept the legacy two-list shape too ("do" actions + "ask" queries).
    steps = [s for s in _as_list(plan.get("steps")) + _as_list(plan.get("do")) + _as_list(plan.get("ask")) if isinstance(s, dict)]

    # Steps run in order: data steps look things up (the last glacier found
    # is what a following open_glacier/terrain step targets), map steps are
    # validated and collected for the browser to apply.
    actions, blocks, summaries = [], [], []
    found_glacier = None
    queries_run = 0
    for step in steps:
        kind = _kind(step)
        if kind in tools.QUERIES:
            if queries_run >= MAX_QUERIES:
                continue
            if queries_run == 0:
                yield {"type": "status", "stage": "looking_up"}
            queries_run += 1
            try:
                result = tools.run_query({**step, "q": kind}, country_names)
            except tools.QueryError as exc:
                blocks.append({"type": "text", "text": str(exc), "tone": "warn"})
                summaries.append(str(exc))
                continue
            except Exception as exc:  # a data source failing shouldn't kill the whole reply
                blocks.append({"type": "text", "text": f"Lookup failed: {exc}", "tone": "warn"})
                continue
            blocks += result["blocks"]
            summaries.append(result["summary"])
            found_glacier = result.get("glacier") or found_glacier
            continue

        action = _clean_action(step)
        if action is None:
            continue
        if action["a"] in ("glacier", "terrain"):
            # Attach the full feature so the browser can open the data sheet
            # without another round trip.
            feature = tools.get_feature(action["id"]) if action.get("id") else found_glacier
            if feature is None and action.get("id"):
                try:
                    found = tools.run_query({"q": "search", "name": str(action["id"])}, country_names)
                    blocks += found["blocks"]
                    feature = found_glacier = found.get("glacier")
                except tools.QueryError:
                    feature = None
            if feature is None:
                continue
            actions.append({"a": action["a"], "feature": feature})
        else:
            actions.append(action)

    if not say:
        say = "Done." if actions and not blocks else "Here's what I found:" if blocks else "Sorry, I couldn't work that out."
    memory = say + (" [" + "; ".join(summaries) + "]" if summaries else "")
    yield {"type": "reply", "say": say, "actions": actions, "blocks": blocks, "memory": memory}
