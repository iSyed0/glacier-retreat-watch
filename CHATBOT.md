# Portal Chatbot — Working Doc

A chat assistant inside HKH Glacier Watch, running on a **local LM Studio model (Gemma 4 E2B)**, that can **answer questions from the portal's data** ("how many glaciers in Pakistan are retreating?", "what was the temperature at this point in 2010?") and **drive the portal on request** ("show the rivers and GLOF-II sensors, zoom to Hunza, play the temperature timeline").

> **How this file works.** Sections between `<!-- AUTO:… -->` markers are regenerated from the code by `scripts/update_chatbot_md.py`. It runs on every `git commit` through the pre-commit hook, and you can also run it by hand. Don't edit inside those blocks; edit everything else freely. Tick roadmap boxes (`- [x]`) as work lands, and the progress table updates itself.

## Status

<!-- AUTO:progress:start -->
**15/22** roadmap items done.

| Phase | Done | |
|---|---|---|
| Phase 0: Plumbing | 5/6 | `#####.` |
| Phase 1: Information | 3/4 | `###.` |
| Phase 2: Automation | 4/6 | `####..` |
| Phase 3: Polish | 3/6 | `###...` |
<!-- AUTO:progress:end -->

---

## Goals

1. **Pull up information:** answer from the glacier dataset, trends, ERA5 temperature, elevation, sensors and boundaries. Use the real numbers, never invented ones.
2. **Automate tasks:** turn a request into portal actions: toggle layers, set opacity, switch basemap, set or play the year, fly to a place, open a glacier's data sheet or terrain view, and open charts.
3. **Chain both:** for example, "find the fastest-retreating named glacier in Pakistan, take me there and open its terrain view."

**Non-goals for v1:** editing data, user accounts, and anything that writes to the server.

## Current stack

| Layer | Technology |
|---|---|
| Map | Mapbox GL JS 3.30 (`mapbox-gl`), wrapped in `MapView.jsx` |
| Frontend | React 19 + Vite 8; all app state is `useState` in `App.jsx` (no Redux or router) |
| Backend | Python FastAPI 0.115 on uvicorn, one process serving both the API and the built frontend on port 8000 (`start.bat`) |
| Data | Static GeoJSON on disk (glaciers, boundaries, sensors, rivers) plus live Google Earth Engine (ERA5-Land, elevation, population, land cover); building tiles from an internal tile server |

**Integration approach:** add the chatbot alongside the map without changing how the map works. `ChatPanel` sits in `App.jsx` next to the existing panels and calls the same setters the Legend uses. `/api/chat` lives in the existing FastAPI app and reuses the existing Python modules. No new server, database or framework is needed.

## Architecture (as built)

The model is **Gemma 4 E2B running locally in LM Studio**. Nothing leaves the machine, and there's no API key or per-request cost.

```
 Browser (React)                          Backend (FastAPI)                        LM Studio (local)
 ┌─────────────────────────┐  POST       ┌──────────────────────────────┐  POST    ┌──────────────────┐
 │ chat/ChatPanel.jsx      │  /api/chat  │ chat/agent.py                │  /api/v1 │ google/gemma-4-  │
 │  message + uiState  ────┼────────────▶│  1. prompt.py → 1 model call ├─/chat───▶│ e2b  (4096 ctx,  │
 │                         │             │  2. parse JSON plan          │◀─SSE─────┤  reasoning off)  │
 │  status / reply / error │◀── SSE ─────┤  3. run data steps (tools.py)│          └──────────────────┘
 │       │                 │             │  4. validate map steps       │  lmstudio.py also wraps
 │       ▼                 │             └──────────────────────────────┘  /models, /models/load,
 │ chat/actions.js → App.jsx setters (same ones the Legend uses)          /models/download(/status)
 └─────────────────────────┘
```

**Why a JSON plan instead of native tool calling:**
- LM Studio's `/api/v1/chat` has **no custom-function field**. Its tools are MCP plugins only.
- A 2B model is unreliable at multi-round tool loops, and each round costs seconds on CPU.
- So the model answers each turn with **one JSON object**: `{"say": "...", "steps": [...]}`.
- Python does the rest:
  1. Runs each data step against the real datasets.
  2. Checks each map step against an allowlist.
  3. Streams one `reply` event: `say` text, `actions` for the browser, and `blocks` (stats and tables built from the data).

**The model never writes numbers.** Every figure comes from `tools.py`.

**Robustness to a small model:**
- `agent._extract_plan` repairs the common breakages: code fences, copied `"a"|"b"` notation, missing braces around steps, and unterminated strings. If the JSON still won't parse, it rebuilds steps from the key/value pairs it can find.
- Unknown step names and layer names are dropped.
- The browser only ever receives validated actions.

**Speed:** about 3–7 s per turn once warm (CPU/Vulkan, about 9 tok/s output).
- The system prompt is identical across turns, so LM Studio reuses its KV cache. Only the map state, the last 4 turns and the new message are processed each time.
- The first `trends` query is slow (about 50 s) because of an Earth Engine round trip. After that it is cached in-process.

### Steps the model can use

| Step | Kind | Backed by |
|---|---|---|
| `stats` (country?, trend?) | data | `tools.q_stats`: counts, area, area-weighted rate, trend split |
| `search` (name?, country?, trend?, sort?) | data | `tools.q_search`: name / RGI ref / id match, sort by `fastest_retreat` / `fastest_gain` / `largest` |
| `glacier` (id) | data | `tools.q_glacier` |
| `point` (lon, lat, year?) | data | `era5_annual.get_point_temp` + `elevation.get_point_elevation` |
| `nearest` (lon, lat, trend) | data | `nearest_glacier.find_nearest` |
| `trends` (region hkh/pk) | data | `trends.get_trends` (falls back to glacier-only when Earth Engine is down) |
| `sensors` (network) | data | sensor GeoJSON files |
| `layer`, `opacity`, `basemap`, `year`, `play` | map | App.jsx setters via `chat/actions.js` |
| `fly`, `fit_hkh` | map | new `flyToTarget` prop on MapView / existing `recenterSignal` |
| `open_glacier`, `terrain`, `close` | map | `setSelectedFeature` / `setTerrainViewFeature` (via `toTerrainFeature` from DataSheet.jsx) |
| `chart` (key) | map | `openChart` |

Glacier tables in replies are clickable: each row opens that glacier on the map.

### Configuration

| Env var | Default | |
|---|---|---|
| `LMSTUDIO_URL` | `http://127.0.0.1:1234` | LM Studio server |
| `LMSTUDIO_MODEL` | `google/gemma-4-e2b` | any LM Studio model key works; bigger models follow the format better |
| `LMSTUDIO_CONTEXT` | `4096` | minimum context; the backend loads a new instance with this if none qualifies |

**LM Studio must have its server running** (Developer tab → Start server, or `lms server start`). The chat panel shows a banner with a **Load now** button if the model isn't loaded with enough context.

### Backend routes added

| Route | Wraps |
|---|---|
| `POST /api/chat` | one turn, SSE: `status` → `reply` \| `error` |
| `GET /api/chat/status` | `GET /api/v1/models`: missing / not_loaded / ready |
| `POST /api/chat/model/load` | `POST /api/v1/models/load` (context `LMSTUDIO_CONTEXT`) |
| `POST /api/chat/model/download` | `POST /api/v1/models/download` |
| `GET /api/chat/model/download/{job_id}` | `GET /api/v1/models/download/status/:job_id` |

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Local LM Studio model (Gemma 4 E2B), called **from the backend only** | Runs offline on NDMA hardware with no API key or cost. The browser never talks to LM Studio. |
| D2 | One model call per turn, returning a JSON plan; Python runs the data lookups | `/api/v1/chat` has no custom tools, and a 2B model is weak at tool loops. This also keeps numbers grounded. |
| D3 | SSE over `POST /api/chat`, with `Content-Encoding: identity` | Streams progress live. The identity header stops GZipMiddleware buffering the stream. |
| D4 | Plain-prose map state in the input, never JSON | When the state was sent as JSON, the model echoed it back as actions. |
| D5 | No conversation storage on the server; history lives in the browser (last 6 turns, replies + query summaries) | Simplest option; revisit if NDMA wants audit logs. |
| D6 | `reasoning: "off"`, `temperature: 0.2` | Thinking tokens roughly double the latency on CPU, and low temperature keeps the JSON stable. |

## Known limitations

- **Place names:** the model guesses coordinates for "fly to Hunza". There's no geocoder yet (Phase 2).
- **The `say` text is model-written** and can be vague ("Pakistan has a retreating trend"). The data blocks below it are always accurate.
- **Stopping a reply doesn't stop LM Studio:** clicking Stop cancels the browser request, but LM Studio finishes generating in the background.
- **No browser test yet:** the UI was built and type-checked, but not yet exercised by hand in a browser.

## Open questions

- [ ] **Hardware:** is this machine (CPU + Vulkan, about 9 tok/s) the production host? A GPU would bring turns under 2 s and allow a larger model (E4B or 12B), which would follow the format more reliably.
- [ ] **Language:** English only, or Urdu as well? Gemma handles Urdu, but the prompt examples are English.
- [ ] **Users:** internal analysts only, or public? A local model handles one request at a time per slot (4 parallel).
- [ ] **Logging:** must conversations be kept for audit?

## Roadmap

### Phase 0: Plumbing
- [x] `backend/chat/lmstudio.py`: client for all five LM Studio endpoints, with auto-load at 4096 context
- [x] `backend/chat/` package: `agent.py`, `tools.py`, `prompt.py`
- [x] `POST /api/chat` SSE endpoint plus status/load/download routes; `POST` added to CORS
- [x] `frontend/src/chat/ChatPanel.jsx`: launcher, panel, streaming status, model banner
- [x] End-to-end round trip verified with curl against the live model
- [ ] Manual browser pass: open the panel, run every suggestion chip, check the map reacts

### Phase 1: Information
- [x] `stats`, `search`, `glacier`
- [x] `trends`, `point`, `nearest`, `sensors`
- [x] Compact results (tables capped at 10 rows; no GeoJSON into the model)
- [ ] Data provenance in answers (WGMS / RGI / ERA5-Land / CIESIN / Esri)

### Phase 2: Automation
- [x] `chat/actions.js` + App.jsx wiring + `uiState` snapshot
- [x] Layer, opacity, basemap, year and timeline actions
- [x] `fly` (new `flyToTarget` on MapView) and `fit_hkh`
- [x] `open_glacier`, `terrain`, `chart`, `close`
- [ ] `geocode` for place names (Mapbox geocoding with the existing token, or a local gazetteer of GB/KP valleys)
- [ ] `glaciers_in_district` (point-in-polygon on `Pakistan_Districts.simplified.geojson`)

### Phase 3: Polish
- [x] Suggested prompts / starter chips
- [x] Clickable glacier rows → open on map
- [x] Error states: LM Studio down, model not loaded/missing, Earth Engine down
- [ ] Export a filtered glacier list as CSV
- [ ] Eval script: the example table below, run against the live model, scored automatically
- [ ] Try `google/gemma-4-e4b` or larger if the hardware allows

## Example requests (test set)

Results from the live model on 2026-10-13, after the prompt fixes:

| Request | Expected steps | Result |
|---|---|---|
| How many glaciers in Pakistan are retreating? | `stats(PK, -1)` | ✅ |
| How many glaciers are in Bhutan? | `stats(BT)` | ✅ |
| Take me to the largest glacier in Pakistan and open 3D view | `search(PK, largest)` → `open_glacier` → `terrain` | ✅ (after the unterminated-string repair) |
| Take me to the fastest retreating glacier in Pakistan and open the 3D view | `search(PK, fastest_retreat)` → `open_glacier` → `terrain` | ✅ |
| Find Baltoro glacier | `search(Baltoro)` | ✅ |
| Show the fastest retreating glaciers in Nepal | `search(NP, fastest_retreat)` | ✅ |
| What's the temperature and elevation at 74.5, 36.3 in 2015? | `point(74.5, 36.3, 2015)` | ✅ |
| Compare Pakistan and HKH trends | `chart(trendsPk)`, `chart(trendsHkh)` | ✅ |
| Turn on rivers and population, satellite basemap | `layer` ×2, `basemap` | ✅ |
| Zoom out to the whole region and hide the boundary | `fit_hkh`, `layer(boundary, off)` | ✅ |
| Play temperature from 2000 on the light map | `year(2000)`, `play`, `basemap(light)` | ✅ |
| How many GLOF stations are there? | `sensors(glof2)` | ✅ |

---

## Backend API inventory

Every route in `app.py`. "Chat tool?" is `yes` when the chatbot reaches the same data, meaning a module function the route calls is also called from `backend/chat/`.

<!-- AUTO:api:start -->
21 routes in `backend/app.py`.

| Route | Params | What it does | Chat tool? |
|---|---|---|---|
| `GET /api/health` | `-` | - | -- |
| `GET /api/config` | `-` | - | -- |
| `GET /api/glaciers` | `-` | - | yes |
| `GET /api/boundary` | `-` | - | -- |
| `GET /api/boundaries/pakistan/{level}` | `level: str` | Pakistan admin boundary outline: level is 'national', 'provinces', or 'districts'. | -- |
| `GET /api/sensors/{key}` | `key: str` | One field sensor/monitoring-station network as GeoJSON points -- key is one of SENSOR_FILES (see above). | yes |
| `GET /api/rivers` | `-` | River / canal / nalla polygons (see RIVERS_FILE above) -- served straight off disk like the other static GeoJSON layers. | -- |
| `GET /api/buildings/index` | `-` | District id + bounds for every building-footprint tileset on the internal tile server, plus the server's own base URL. The frontend build... | -- |
| `GET /api/population/raster` | `-` | Live XYZ tile URL for gridded population density (CIESIN GPWv4.11, log10-scaled), HKH-cropped. No parameters -- there's only one snapshot. | -- |
| `GET /api/landcover-esri/tile` | `year: int = landcover.MAX_YEAR` | Live XYZ tile URL for one year's Sentinel-2 10m land cover, HKH-cropped (mosaicked across every UTM tile covering the region -- see landc... | -- |
| `GET /api/trends` | `-` | Region-wide glacier elevation-change rate vs. mean temperature, one figure per 5-year period across the 1999-2019 record (see trends.py -... | yes |
| `GET /api/trends/pk` | `-` | Same as /api/trends, scoped to glaciers inside Pakistan and to the Pakistan portion of the HKH boundary for the temperature series. | yes |
| `GET /api/era5-annual/range` | `-` | The earliest/latest years the annual temperature layer will query. | -- |
| `GET /api/era5-annual/tiles` | `-` | Every year's tile in one response (see era5_annual.get_all_tiles) -- the frontend fetches this once up front rather than one request per... | -- |
| `GET /api/hover-info` | `lon: float, lat: float, year: int = era5_annual.MAX_YEAR` | Temperature (deg C, same year the annual-temperature slider is on) and elevation (m) at a single point -- backs the Legend's "temperature... | yes |
| `GET /api/nearest-glacier` | `lon: float, lat: float, trend: int, max_km: float = 50.0` | The closest glacier with the given trend (-1 retreating, 1 balanced, 0 no significant trend) to (lon, lat) -- backs TerrainView.jsx's sec... | yes |
| `POST /api/chat` | `req: ChatRequest` | One chatbot turn against the local LM Studio model (see chat/), streamed as Server-Sent Events: status updates while the model loads / re... | (chatbot) |
| `GET /api/chat/status` | `-` | Whether LM Studio is reachable and the chatbot model is loaded with enough context (state: missing | not_loaded | ready). | (chatbot) |
| `POST /api/chat/model/load` | `-` | Load the chatbot model in LM Studio (no-op if a big-enough instance is already loaded). | (chatbot) |
| `POST /api/chat/model/download` | `-` | Start downloading the chatbot model in LM Studio; poll the job below. | (chatbot) |
| `GET /api/chat/model/download/{job_id}` | `job_id: str` | - | (chatbot) |
<!-- AUTO:api:end -->

## UI state (automation surface)

Every piece of `App.jsx` state. "Chat action?" is `yes` when the setter is wired to the chatbot (App.jsx's "Chatbot -> portal" block or `frontend/src/chat/`).

<!-- AUTO:ui_state:start -->
42 `useState` hooks in `frontend/src/App.jsx`.

| State | Setter | Initial | Note | Chat action? |
|---|---|---|---|---|
| `config` | `setConfig` | `null` | - | -- |
| `selectedFeature` | `setSelectedFeature` | `null` | - | yes |
| `terrainViewFeature` | `setTerrainViewFeature` | `null` | - | yes |
| `logoError` | `setLogoError` | `false` | - | -- |
| `mapStyleId` | `setMapStyleId` | `DEFAULT_MAP_STYLE_ID` | - | yes |
| `recenterSignal` | `setRecenterSignal` | `0` | - | yes |
| `flyToTarget` | `setFlyToTarget` | `null` | { lon, lat, zoom, seq } -- set by the chatbot | yes |
| `era5AnnualVisible` | `setEra5AnnualVisible` | `false` | - | yes |
| `era5AnnualOpacity` | `setEra5AnnualOpacity` | `0.65` | - | yes |
| `era5AnnualRange` | `setEra5AnnualRange` | `null` | { min: 1999, max: 2026 } | -- |
| `era5AnnualYear` | `setEra5AnnualYear` | `null` | the year the user has selected | yes |
| `era5AnnualTiles` | `setEra5AnnualTiles` | `{}` | year -> { tileUrlTemplate, year, meanTempC }, all fetched in one batch | -- |
| `era5AnnualStatus` | `setEra5AnnualStatus` | `'idle'` | idle | loading | ready | error -- for the one-time batch fetch, not per-year | -- |
| `era5AnnualError` | `setEra5AnnualError` | `''` | - | -- |
| `era5AnnualPlaying` | `setEra5AnnualPlaying` | `false` | - | yes |
| `boundaryVisible` | `setBoundaryVisible` | `true` | - | yes |
| `pkNationalVisible` | `setPkNationalVisible` | `false` | - | yes |
| `pkProvincesVisible` | `setPkProvincesVisible` | `false` | - | yes |
| `pkDistrictsVisible` | `setPkDistrictsVisible` | `false` | - | yes |
| `buildingsVisible` | `setBuildingsVisible` | `false` | - | yes |
| `buildingsIndex` | `setBuildingsIndex` | `null` | { tileServer, districts: [{id, bounds}] } | -- |
| `buildingsStatus` | `setBuildingsStatus` | `'loading'` | loading | ready | error | -- |
| `buildingsError` | `setBuildingsError` | `''` | - | -- |
| `mapZoom` | `setMapZoom` | `null` | - | -- |
| `popRasterVisible` | `setPopRasterVisible` | `false` | - | yes |
| `popRasterOpacity` | `setPopRasterOpacity` | `0.65` | - | yes |
| `popRasterTile` | `setPopRasterTile` | `null` | { tileUrlTemplate } | -- |
| `popRasterStatus` | `setPopRasterStatus` | `'loading'` | loading | ready | error | -- |
| `popRasterError` | `setPopRasterError` | `''` | - | -- |
| `sensorsGlof2Visible` | `setSensorsGlof2Visible` | `false` | - | yes |
| `sensorsGlof2DamagedVisible` | `setSensorsGlof2DamagedVisible` | `false` | - | yes |
| `sensorsBriFfVisible` | `setSensorsBriFfVisible` | `false` | - | yes |
| `sensorsFocus2026Visible` | `setSensorsFocus2026Visible` | `false` | - | yes |
| `sensorsGmrcWapdaVisible` | `setSensorsGmrcWapdaVisible` | `false` | - | yes |
| `riversVisible` | `setRiversVisible` | `false` | - | yes |
| `hoverInfoVisible` | `setHoverInfoVisible` | `false` | - | yes |
| `landcoverEsriVisible` | `setLandcoverEsriVisible` | `false` | - | yes |
| `landcoverEsriOpacity` | `setLandcoverEsriOpacity` | `0.7` | - | yes |
| `landcoverEsriTile` | `setLandcoverEsriTile` | `null` | { tileUrlTemplate, year } | -- |
| `landcoverEsriStatus` | `setLandcoverEsriStatus` | `'idle'` | idle | loading | ready | error | -- |
| `landcoverEsriError` | `setLandcoverEsriError` | `''` | - | -- |
| `charts` | `setCharts` | `() =>` | - | -- |

Chart keys (`CHART_DEFS`, opened via `openChart(key)`): `trendsHkh`, `trendsPk`, `specificMassHkh`, `specificMassPk`
<!-- AUTO:ui_state:end -->

## Glacier dataset facts

<!-- AUTO:dataset:start -->
- **38,781** glacier points; **4,498** have a `name`, the rest only an RGI `ref`.
- **38,595** have a `rate`; **38,561** have a `pRecent` (2020-2026) period.
- By trend: retreating **37,576**, no significant trend **549**, balanced/advancing **656**
- By country: CN **12,312**, IN **11,466**, PK **8,863**, NP **3,063**, AF **2,418**, BT **534**, MM **85**, TJ **40**
- Property keys: `area`, `country`, `fv`, `id`, `mb`, `name`, `p`, `pRecent`, `rate`, `ref`, `trend`
<!-- AUTO:dataset:end -->

## Recent chatbot activity

<!-- AUTO:activity:start -->
- `27b075a` 2026-10-13 Integrate local LLM chatbot (google/gemma-4-e2b via LM Studio)
<!-- AUTO:activity:end -->

## Notes / scratch

_Free space for findings while building._
