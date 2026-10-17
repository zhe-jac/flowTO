# Roadmap: Toronto Traffic Sandbox

Everything needed to go from an empty repo to a judged, submitted project. Tasks are tagged by priority:

- **P0:** the demo does not work without it. Build first.
- **P1:** makes it a winning demo. Build once P0 is solid.
- **P2:** stretch. Only after P1 is done and stable.

Owners are by role (three people), not fixed. Swap freely:

- **MAP:** frontend, map, UI, before/after, charts
- **SIM:** simulation engine, routing, interventions, metrics
- **DATA:** data pipeline, AI, backend, deploy, pitch and submission

---

## 0. North star

> A judge opens a link, sees Toronto with traffic moving, drags a closure onto the Gardiner, hits play, and in under 30 seconds watches the right-hand city jam up while the left one flows. Ward happiness drops, and a one-paragraph AI summary explains why.

If a task doesn't serve that moment, or the School of Cities criteria (**real problem, Toronto data, non-partisan, useful**), it goes after P1.

---

## 1. Prize strategy

| Track | Fit | What we build for it | Priority |
|---|---|---|---|
| **HTV x School of Cities** (main) | Direct | The whole product: election framing, Toronto Open Data, per-ward results, neutrality, methodology page | P0 |
| Overall 1st/2nd/3rd | Automatic | Polish and demo quality | P0 |
| **[MLH] Best Use of Gemini API** | Strong | Natural-language scenario builder, AI impact summary, "ask about this result" | P1 |
| **Best AI for Social Impact** | Strong | Same Gemini features, framed around civic access | P1 |
| **Best Climate Action or Sustainability** | Good | CO₂ and idle-time metric, bike-lane scenario, "emissions vs. baseline" chart | P1 |
| **[MLH] Best Domain Name from GoDaddy Registry** | Trivial | Register a domain through the MLH offer and point it at the deploy | P1 (10 minutes) |
| **[MLH] DEV Writing Challenge** | Trivial | Publish a build write-up on DEV after submission | P2 (post-event) |
| **[MLH] Best Use of Tiger Data** | Moderate | Timescale hypertable of per-tick run metrics, saved scenarios gallery, continuous aggregates | P2 |
| **[MLH] Best Use of Vultr** | Moderate | Host the production deploy on a Vultr instance instead of, or as well as, Vercel | P2 |
| Solana, PointClickCare, KAZE, FDM, Papers, FinTech, Healthcare, Beginner, Solo | Poor or ineligible | Skip; forcing them in weakens the pitch | — |

> **Action (DATA, hour 0):** Check Devpost for a limit on how many tracks one project can enter, and confirm the submission deadline. Read the School of Cities judging criteria if any were published.

---

## 2. Key technical decisions and why they're feasible

| Decision | Choice | Reasoning |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript** | No `index.html` or `.js` anywhere (TSX, `next.config.ts`, `.postcssrc.json`, `biome.json`). Built-in API routes for Gemini and keys. One-click Vercel deploy |
| 2D vs 3D | **Both, with one map** | MapLibre + OpenFreeMap tiles give 3D building extrusions across all of Toronto for free. "3D" is pitch 60° with buildings on, and "2D" is pitch 0° with buildings off. A Babylon.js custom engine like Shift's is weeks of work, so we're not doing it |
| Vehicles | **deck.gl** layers over MapLibre (`MapboxOverlay`, interleaved) | GPU-rendered; tens of thousands of moving points at 60 fps |
| Simulation location | **In the browser, in Web Workers** | Instant feedback, no sim server, and the UI never freezes |
| Sim model | **Mesoscopic agent model + BPR link travel times** | Standard planning formula, explainable in one sentence, and cheap per tick |
| Area | **City of Toronto only** (the official boundary, not the GTA) | The Centreline and all City datasets cover exactly this area |
| Network size | Expressways + major/minor arterials + collectors; **local streets excluded** | Roughly 15–25k directed edges instead of ~70k+. Locals carry little through-traffic and would kill performance |
| Routing cost | **Baseline routes precomputed at build time**. At runtime, only affected trips reroute | Routing 30k trips live would take minutes. Shortest-path trees from zone origins plus incremental reroutes take seconds |
| Agent scale | 1 simulated vehicle = *N* real vehicles (start at N = 10) | Shown in the UI. Keeps the agent count around 20–40k per sim |
| Before/after | Two workers (baseline and scenario), same seed and demand | Differences are caused only by the intervention |
| AI | **Gemini** (`@google/genai`) with JSON-schema structured output | Targets the MLH Gemini track, and the output is validated with `zod` before it touches the sim |

**Fallback if citywide is too slow (decide by hour 12):** Set `SIM_BOUNDS` to a smaller area, such as the old City of Toronto (Humber to Victoria Park, the lake to the 401). Leave the rest of the city rendered but not simulated. This is a config flag, not a rewrite.

---

## 3. Architecture

```
scripts/ (Node + tsx, run once)                 src/ (Next.js app)
──────────────────────────────                  ─────────────────────────────────────────────
fetch-*.ts  → data/raw/                         app/page.tsx            sandbox UI
build-network.ts → public/data/network.bin      app/methodology/page.tsx
build-zones.ts   → public/data/zones.json       app/api/ai/scenario     NL → Scenario (Gemini)
build-demand.ts  → public/data/demand.bin       app/api/ai/summary      results → summary
build-baseline.ts→ public/data/baseline.bin     app/api/scenarios       save/load (P2, Tiger)
build-presets.ts → public/data/presets/*.json   components/map, tools, timeline, panels, charts
                                                sim/  engine, routing, bpr, interventions,
                                                      metrics, happiness, rng, sim.worker.ts
                                                store/ zustand: viewport, scenario, playback, results
```

**Core types** (`src/sim/types.ts`). Agree on these first, because all three roles code against them:

- `Network`:
  - nodes `{ id, lon, lat }`
  - edges `{ id, from, to, lengthM, freeSpeedMps, lanes, capacityVph, roadClass, wardId, geometry }`
- `Zone`: neighbourhood `{ id, name, wardId, originNodes[], population, jobs }`
- `Trip`: `{ id, originZone, destZone, originNode, destNode, departSec }`
- `Intervention`, a union of:
  - `closure`
  - `laneReduction`
  - `construction`
  - `collision`
  - `eventSurge`
  - `weather`

  Each has `{ id, kind, edgeIds | area, startSec, endSec, params }`.
- `Scenario`: `{ id, name, timeWindow: { startSec, endSec }, interventions[], seed, version }`
- `TickSnapshot`: `{ simSec, positions: Float32Array, edgeLoad: Float32Array, metrics }`
- `RunResults`: time series, per-ward stats, top affected edges, happiness, CO₂

---

## Phase 0: Setup (hours 0–2) · everyone

- [ ] **P0** Agree the vision, demo moment and roles (this doc). Read the README together.
- [ ] **P0** Scaffold:
  - `create-next-app` with TypeScript, App Router, Tailwind and a `src/` directory
  - delete any `.js` config, and turn on TS strict mode with `allowJs: false`
- [ ] **P0** Add dependencies: `maplibre-gl`, `react-map-gl`, `deck.gl` (+ `@deck.gl/mapbox`, `@deck.gl/geo-layers`), `zustand`, `recharts`, `comlink`, `flatbush`, `@turf/turf`, `zod`, `lz-string`, `@google/genai`.
- [ ] **P0** Add dev dependencies: `tsx`, `vitest`, `@biomejs/biome`, `@types/geojson`.
- [ ] **P0** Init shadcn/ui and add the components we need: button, slider, card, tabs, dialog, tooltip, toggle-group, sonner.
- [ ] **P0** Add `package.json` scripts: `dev`, `build`, `test`, `check`, `data:fetch`, `data:build`.
- [ ] **P0** Add `.gitignore` (`data/raw/`, `.env*.local`, `.next/`) and `.env.example`.
- [ ] **P0** Write `src/sim/types.ts` with the core types above, and commit them so everyone builds on the same contract.
- [ ] **P0** Deploy the empty app to Vercel on day 1, so deploy problems surface early.
- [ ] **P1** Branch convention: short-lived feature branches and PRs into `main`, with `main` always demo-able.

**Checkpoint H2:** The app runs locally and on a Vercel URL, and the types are merged.

---

## Phase 1: Data pipeline (hours 1–10) · DATA

All scripts live in `scripts/*.ts`, run with `tsx`, and are idempotent: they skip downloads that already exist. They use the CKAN API (`https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=<dataset>`).

- [ ] **P0** `fetch-datasets.ts`:
  - Look up each dataset ID on the portal. Verify the exact names and pick GeoJSON or CSV resources.
  - Download the Centreline, City Wards, Neighbourhoods (158), Neighbourhood Profiles 2021, the traffic volume / turning movement counts and the Toronto boundary.
- [ ] **P0** `build-network.ts`:
  - Filter the Centreline to expressway, major arterial, minor arterial and collector. Keep ramps.
  - Build the directed graph from the from/to intersection IDs, respecting the one-way direction code.
  - Assign default lanes, speed and capacity per road class (see the assumptions table below).
  - Tag each edge with its ward (midpoint-in-polygon).
  - Remove disconnected islands, keeping the largest strongly connected component.
  - Simplify the geometry and precompute cumulative lengths for interpolation.
  - Output a compact binary file (typed arrays) plus a small JSON index.
  - Target size: < 10 MB gzipped.
- [ ] **P0** `build-zones.ts`:
  - Use the 158 neighbourhoods, each with its ward, population (census) and a jobs estimate.
  - Pick 3–8 origin/destination nodes per zone on arterials inside the zone.
- [ ] **P0** `build-demand.ts`:
  - Use a gravity model: trips(i→j) ∝ population_i · jobs_j · f(distance).
  - Scale to a target vehicle-trip total for the time window.
  - Spread departures over the time-of-day profile built from the counts (15-minute bins).
  - Seeded RNG, so the output is deterministic.
- [ ] **P0** `build-baseline.ts`:
  - Run free-flow shortest paths, then 3–5 iterations of the method of successive averages with BPR to approximate congested routes.
  - Store each trip's route as an edge-index array.
  - This is the starting point of every runtime simulation.
- [ ] **P1** `calibrate.ts`:
  - Compare simulated peak-hour edge volumes to the counted volumes near count locations.
  - Report the correlation (R²) and tune the scale factor and capacities.
  - Put the R² number in the pitch and on the Methodology page.
- [ ] **P1** `fetch-road-restrictions.ts`: Pull current City road restrictions and convert them to preset `Scenario` JSON ("Today's real closures").
- [ ] **P1** `build-presets.ts`: Build the hand-made demo scenarios (see section 8) as JSON in `public/data/presets/`.
- [ ] **P1** Lane overrides: Correct the lane counts for major corridors (Gardiner, DVP, 401, Lake Shore, Bloor, Yonge, University, Spadina, Eglinton) from OpenStreetMap `lanes` tags or a hand list.
- [ ] **P1** Jobs data:
  - Use the Toronto Employment Survey if a usable table is on the portal.
  - Otherwise, weight destinations by known employment centres (Financial District, North York Centre, Scarborough Centre, Etobicoke Centre, the Airport-adjacent area) and document that choice.
- [ ] **P2** Cycling Network dataset, for the "add or remove a bike lane" scenario: remove one lane on that corridor and mark it on the map.
- [ ] **P2** Police collision data (KSI), as an optional "collision hotspots" overlay.

**Assumptions table** (lives in `src/sim/config.ts` and is shown on the Methodology page; all values are tunable):

| Road class | Default lanes/dir | Free-flow km/h | Capacity veh/h/lane |
|---|---|---|---|
| Expressway | 3 | 90 | 1,800 |
| Major arterial | 2 | 50 | 800 |
| Minor arterial | 2 | 45 | 700 |
| Collector | 1 | 40 | 600 |

Arterial capacities are lower than expressway capacities because traffic signals take a share of each hour. Cite the source we use (for example, the Highway Capacity Manual ballpark) on the Methodology page.

**Checkpoint H10:**
- `public/data/` has the network, zones, demand and baseline.
- A script prints the edge count, trip count and file sizes.

---

## Phase 2: Simulation engine (hours 2–18) · SIM

All code is pure TypeScript in `src/sim/` with no DOM, so it's unit-testable with Vitest. Start against a **tiny hand-made 10-node fixture network** while the real data is being built.

- [ ] **P0** `rng.ts`: a seeded PRNG (mulberry32). The same seed gives the same run.
- [ ] **P0** `routing.ts`:
  - A binary-heap Dijkstra/A* over typed arrays.
  - `shortestPathTree(origin, costs)` and `route(origin, dest, costs)`.
  - Respects a `blocked` bitmask.
- [ ] **P0** `bpr.ts`: `travelTime(edge, volume)`. Volume is the rolling flow on the edge, converted to an hourly rate.
- [ ] **P0** `engine.ts`, a tick loop with a fixed step (e.g., 5 sim-seconds). Each tick:
  1. Release trips whose departure time has arrived.
  2. Advance each active vehicle along its route at its current edge's speed.
  3. Handle edge transitions. If the next edge is closed or over its storage limit, the vehicle waits, and that waiting is how queues and spillback emerge.
  4. Update edge flows and travel times.
  5. Mark arrivals.
- [ ] **P0** Interpolated positions: output a `Float32Array` of lon/lat per active vehicle each frame, for deck.gl.
- [ ] **P0** `interventions.ts`, which applies interventions at their start time and reverts them at their end time:
  - **closure:** mark the edges blocked, and reroute vehicles whose remaining route uses them.
  - **laneReduction / construction:** capacity × (remaining lanes / lanes). Construction also lowers speed.
  - **collision:** a short closure, then reduced capacity for a recovery period.
- [ ] **P0** Rerouting:
  - **Immediate:** affected vehicles reroute from their current node.
  - **Periodic:** every N sim-minutes, recompute trees for a rotating subset of origins using current costs, so drivers "learn" detours.
- [ ] **P0** `metrics.ts`. Per tick: vehicles in network, average speed, cumulative vehicle-hours of delay, and completed trips. Per trip: actual vs. free-flow time.
- [ ] **P0** `sim.worker.ts`, exposed with comlink:
  - `init(data, scenario)`, `step(dtReal, speed)`, `seek(simSec)`, `snapshot()`, `results()`.
  - Transfers typed arrays without copying.
- [ ] **P0** Two-worker orchestration (`src/sim/runner.ts`):
  - Run the baseline and scenario in lock-step on the same clock and seed.
  - Cache baseline results per time window, since the baseline never changes.
- [ ] **P0** Unit tests on the fixture:
  - A closure forces a detour.
  - A lane reduction increases travel time.
  - The same seed produces identical results.
  - No vehicle ever enters a closed edge.
- [ ] **P1** **weather:**
  - An area or citywide intensity: light, moderate or heavy.
  - Lowers free-flow speed and capacity inside the area.
  - Starting values are ~10% / 5% for light up to ~35% / 25% for heavy. Verify these against FHWA inclement-weather studies and cite them.
- [ ] **P1** **eventSurge:** a venue node plus attendees plus an end time. Inject trips from the venue to zones weighted by population, starting at the end time.
- [ ] **P1** `happiness.ts`:
  - Per trip: score = 100 · clamp(1 − (actual / baseline − 1) / 1.0, 0, 1). Stuck or uncompleted trips score 0.
  - Ward score: the mean over trips originating in the ward.
  - Citywide score: the trip-weighted mean.
  - Emoji tiers: 😀 ≥ 80, 🙂 ≥ 60, 😐 ≥ 40, 😠 ≥ 20, 😡 below 20.
- [ ] **P1** `emissions.ts`: CO₂ from vehicle-km plus idle-hours, using a cited average emission factor. Report baseline vs. scenario.
- [ ] **P1** Fast-forward / jump ahead: headless stepping with no position output until the target time.
- [ ] **P1** Performance pass. Profile the tick on the full network, aiming for ≤ 8 ms per tick per worker at 30k agents. If it's too slow, cut agents (raise the scale factor) or switch on `SIM_BOUNDS`.
- [ ] **P2** "Optimize" helper: given a closure, try 3–5 candidate mitigations (reopen a lane on a parallel road, extend green / capacity +15% on the detour corridor), rank them by the happiness recovered, and show the best one. This is the "planners optimize" story.
- [ ] **P2** Transit outage (Line 1 or 2 down): convert a share of that corridor's transit trips into car trips.
- [ ] **P2** Emergency access: free-flow vs. congested travel time from the nearest fire station to selected points.

**Checkpoint H12:** The real network loads in a worker, the baseline runs, and a closure measurably changes delay. Decide here whether the sim stays citywide or uses `SIM_BOUNDS`.

**Checkpoint H18:** All P0 interventions plus weather and the event surge work, and the tests pass.

---

## Phase 3: Map and interaction (hours 2–20) · MAP

- [ ] **P0** Map component: MapLibre with the OpenFreeMap style, centred on Toronto (~43.70, −79.40) with bounds limited to the city. Draw the city boundary outline.
- [ ] **P0** 2D / 3D toggle:
  - 3D is pitch 60° with building `fill-extrusion` from the tile `render_height`.
  - 2D is pitch 0° with extrusions hidden.
  - Animate the transition.
- [ ] **P0** deck.gl overlay (`MapboxOverlay`, interleaved) with:
  - a vehicles layer (`ScatterplotLayer` reading the worker's `Float32Array`, coloured by speed: green → yellow → red)
  - a road congestion layer (`PathLayer` coloured by volume / capacity)
- [ ] **P0** Tool palette (left rail): Closure, Lane reduction, Construction, Collision, Event, Weather, Eraser.
- [ ] **P0** Drag-and-drop onto the map:
  - Point tools snap to the nearest edge using a `flatbush` index, with a hover highlight of the segment that will be affected.
  - Closure supports clicking several segments or dragging along a corridor.
  - Show a barricade icon on placed closures (deck.gl `IconLayer`).
- [ ] **P0** Intervention editor popover: start and end time, direction (one or both), lanes closed, intensity, and delete.
- [ ] **P0** Timeline bar (bottom):
  - time-window picker (presets: AM rush 7–10, midday, PM rush 16–19, custom)
  - play/pause, speed (1×, 10×, 30×, 60×, 120×), a scrubber and "+15 min / +1 h" jump buttons
  - a clock display ("08:42 AM")
- [ ] **P0** Before/after view: two maps side by side with synced `viewState`, labelled **Baseline** and **Your scenario**. Interventions are drawn only on the scenario side.
- [ ] **P1** Swipe mode: one map with a draggable vertical divider between the baseline and scenario layers.
- [ ] **P1** Difference mode: one map with roads coloured by the change in travel time (blue = faster, red = slower).
- [ ] **P1** Ward overlay: ward polygons shaded by happiness change. Hover shows the ward name and score.
- [ ] **P1** Weather area tool: draw a circle or polygon, or choose "citywide". Add a light snow or rain particle effect in 3D mode (deck.gl or CSS).
- [ ] **P1** Event tool: a venue picker (Rogers Centre, Scotiabank Arena, BMO Field, Coca-Cola Coliseum, Budweiser Stage) with attendance and end time.
- [ ] **P1** Click a vehicle: highlight its full route, its origin and destination neighbourhoods, and its delay vs. baseline.
- [ ] **P1** Camera presets: Downtown, Gardiner/DVP, Midtown (Yonge–Eglinton), Scarborough Centre, North York Centre.
- [ ] **P1** Responsive layout, with a usable panel on a laptop screen (the judging table) and a projector.
- [ ] **P2** 3D landmark pop: a CN Tower model (a free glTF) via `ScenegraphLayer`. Cosmetic only.
- [ ] **P2** Keyboard shortcuts: space to play/pause, 1–6 for tools, D to toggle 2D/3D.

**Checkpoint H20:** You can drag a closure onto a real road, hit play and see both maps animate in sync.

---

## Phase 4: Results and dashboard (hours 14–24) · MAP + SIM

- [ ] **P0** Results panel (right rail), as baseline vs. scenario cards with deltas:
  - average trip time
  - total vehicle-hours of delay
  - trips completed
  - citywide happiness
- [ ] **P0** Live charts (Recharts), updating during playback:
  - vehicles on the network over time
  - average speed over time
  - cumulative delay over time

  Each chart shows two lines, baseline and scenario.
- [ ] **P0** "Most affected roads": a top 10 list of street names with +minutes. Clicking one flies to it.
- [ ] **P1** Ward table: all 25 wards with the happiness emoji, Δ score and Δ average commute, sortable.
- [ ] **P1** CO₂ card: baseline vs. scenario, in tonnes and as a % change.
- [ ] **P1** End-of-run summary modal: the key numbers plus the AI summary (Phase 5) plus a share button.
- [ ] **P2** Export the results as CSV and as a PNG snapshot, for journalists.

---

## Phase 5: AI features with Gemini (hours 12–26) · DATA

All calls go through Next.js route handlers, so the key never reaches the browser. Use the current Gemini Flash model for speed, and keep the model ID in one config constant.

- [ ] **P0 (for the Gemini track)** `POST /api/ai/scenario`, natural language → `Scenario`:
  - Give Gemini a JSON schema plus a gazetteer of major road names and venues.
  - Gemini returns `{ interventions: [{ kind, roadName, fromCross, toCross, direction, start, end, intensity }] }`.
  - The server resolves road names to edge IDs using the Centreline street names and cross-streets.
  - Validate with `zod`, and show the user what was understood before applying it.
- [ ] **P0 (for the Gemini track)** `POST /api/ai/summary`, results → summary:
  - Send the metrics JSON (no raw positions).
  - Gemini returns a 3–4 sentence, neutral, plain-language summary: which wards are hit, by how much, why (the detour routes) and caveats.
  - System prompt guardrails: never mention candidates or parties, never recommend a vote, always state uncertainty.
- [ ] **P1** "Ask about this result" chat box, grounded on the run's results JSON. Example: "Why did Ward 14 get worse?"
- [ ] **P1** Prompt input UI: a text box at the top ("Describe a what-if…") with 3 example chips.
- [ ] **P1** Failure handling: a timeout, a clear error toast and the manual tools always working without AI.
- [ ] **P2** Accessibility: a summary read-aloud button (browser `speechSynthesis`) and a plain-language reading level.

---

## Phase 6: Sharing, storage and civic polish (hours 18–28)

- [ ] **P0 (MAP)** Shareable URL: `Scenario` → JSON → `lz-string` → `?s=…`. Opening the link restores the scenario and auto-plays.
- [ ] **P0 (MAP)** Landing state:
  - Explain it in one line: "Test what road decisions do to Toronto, before they happen."
  - Offer 3 big preset buttons and a neutrality note.
- [ ] **P0 (DATA)** `/methodology` page covering:
  - the data sources
  - the model, in plain English
  - the assumptions table
  - the calibration R²
  - the limitations
  - neutrality
- [ ] **P1 (MAP)** Onboarding: 3-step tooltips (drag a tool → press play → read the results).
- [ ] **P1 (MAP)** Accessibility: keyboard-reachable tools, a colour-blind-safe congestion palette (also encode congestion in line width) and ARIA labels.
- [ ] **P1 (MAP)** Mobile view: read-only results plus playback for shared links. Editing is desktop-only.
- [ ] **P2 (DATA, for the Tiger track)** Tiger Data / Timescale:
  - A `scenarios` table and a `run_metrics` hypertable `(time, run_id, ward_id, avg_speed, delay_vh, happiness, co2)`.
  - A continuous aggregate for the gallery stats.
  - `POST/GET /api/scenarios` routes and a "Community scenarios" gallery listing the most-run scenarios.
- [ ] **P2** French toggle for the main UI strings: Toronto is bilingual-adjacent, and it's an accessibility plus.

---

## Phase 7: Deploy and domain (hours 20–30) · DATA

- [ ] **P0** Production deploy on Vercel from `main`, with env vars set. Make sure the static data files are served with long cache headers and gzip/brotli.
- [ ] **P0** Smoke-test the deployed site on a fresh browser:
  - the first load time
  - the worker loads data
  - the AI routes work
- [ ] **P1 (GoDaddy track)** Register a domain through the MLH GoDaddy Registry offer and point its DNS at the deploy.
- [ ] **P2 (Vultr track)**:
  - Deploy the same Next.js app on a Vultr instance using Docker, `next start` and Caddy for HTTPS.
  - Put the domain on the Vultr deploy, and keep Vercel as the backup.
- [ ] **P1** A **local offline fallback**: `pnpm build && pnpm start` on a teammate's laptop with the data bundled, in case the venue Wi-Fi dies during judging.

---

## Phase 8: Testing and hardening (hours 24–32) · everyone

- [ ] **P0** Run every preset scenario end to end on the deployed site, three times each. The results must be identical (determinism).
- [ ] **P0** Performance check on the weakest team laptop. The 3D view stays ≥ 30 fps during playback. If not, lower the agent count or default to 2D.
- [ ] **P0** Edge cases:
  - closing a road with no detour (isolated area): stuck trips are counted and shown, and nothing crashes
  - overlapping interventions
  - deleting an intervention mid-run
  - scrubbing backwards (re-run from 0 headlessly)
- [ ] **P0** Freeze `main` at hour 32: bug fixes only after that.
- [ ] **P1** Sanity-check the numbers against intuition, with a teammate who drives in Toronto: a Gardiner closure should hurt Lake Shore, Front and the DVP, not Scarborough.
- [ ] **P1** Read the Methodology page and the AI summaries for any partisan wording.

---

## Phase 9: Demo, pitch and submission (hours 28–36) · DATA leads, everyone rehearses

### Demo scenarios (presets)

Build these as JSON and test them most.

1. **Gardiner closure + snowstorm, AM rush.** The hero demo, showing big visible spillback onto Lake Shore and Front.
2. **Jays game lets out, 4–6 PM, plus a Spadina lane closure.** The event surge.
3. **Remove a bike lane, adding a car lane on Bloor St (Bathurst → Avenue Rd).** Shows that adding capacity doesn't always help much (induced routing). This is a live election topic, framed as a policy and never as a candidate.
4. **Today's real closures.** Loaded from the City's Road Restrictions feed, showing that it's real data.

### Pitch (3 minutes; adjust to the judging slot)

1. **Hook, 0:00–0:20.** "Toronto votes in 9 days. Traffic is one of the top issues on the ballot, and every platform has a plan for our roads. But no voter, journalist or community group can actually *see* what those plans would do."
2. **Problem, 0:20–0:40.** Traffic modelling exists, but it's locked in consultant tools and city departments. Residents get press releases, not evidence. School of Cities asked for civic info that's useful, accessible and actionable, and this is the gap.
3. **Solution, 0:40–0:55.** "Toronto Traffic Sandbox is SimCity for the real Toronto, built entirely on City of Toronto open data."
4. **Live demo, 0:55–2:15.**
   1. The baseline AM rush, flowing.
   2. Drag a closure onto the Gardiner, then add a snowstorm, and press play at 60×.
   3. The right side jams while the left side flows, with cars visibly rerouting onto Lake Shore.
   4. The results: "+X min average commute, Ward 10 happiness 72 → 41."
   5. Type the Jays game scenario in plain English, and Gemini builds it.
   6. Close on the AI summary and the share link.
5. **Credibility, 2:15–2:35.**
   - Real Centreline network, real intersection counts and the standard BPR model planners use.
   - The calibration R² against real counts.
   - Honest about the limitations, all on the Methodology page.
6. **Impact and neutrality, 2:35–2:50.** "It tests policies, not candidates. Any resident can share a scenario with their councillor or a reporter before October 26 and long after."
7. **Close, 2:50–3:00.** What's next: transit and cycling, live closure feeds, and partnering with community groups and newsrooms. "Before Toronto changes a road, anyone should be able to see what happens."

**Anticipated judge questions.** Prepare one-sentence answers:

- **How accurate is it?** It's directional. It's calibrated to the City's counts (show R²), the limitations are listed, and it's for comparing options, not forecasting exact minutes.
- **How is this non-partisan?** Presets are policies and events, never names. The AI is guardrailed, and the methodology is public.
- **Why not SUMO?** SUMO is a professional desktop simulator. We traded some fidelity for instant, in-browser accessibility for non-experts.
- **Who would use it after the election?** Community groups responding to construction notices, journalists covering closures, and councillor offices.
- **What's the hardest part?** Making a citywide simulation run in the browser, using precomputed routes and incremental rerouting.

### Submission checklist

- [ ] Devpost project page:
  - tagline
  - inspiration, what it does, how we built it, challenges, accomplishments, what we learned, what's next
  - the "Built with" list
- [ ] Select the tracks: School of Cities, Gemini, AI for Social Impact, Climate/Sustainability, GoDaddy domain (+ Tiger and Vultr if built).
- [ ] Demo video, 2–3 minutes, screen-recorded from the hero scenario with a voice-over. Record it early (hour 30) and re-record if time allows.
- [ ] Screenshots: the 3D before/after, the ward happiness map, the results panel and the AI summary.
- [ ] Public GitHub repo with the README, Methodology and a clean `main`. No secrets committed (check `git log` for `.env`).
- [ ] Live URL and domain on the Devpost page.
- [ ] Slides, only if the format requires them: 5 slides (problem, solution, demo screenshot, how it works plus data, impact/neutrality).
- [ ] Submit **at least 1 hour before the deadline**, then keep editing the submission rather than submitting late.
- [ ] **Post-event (P2):** the DEV Writing Challenge article, "Building a citywide traffic simulator in the browser for Toronto's election".

---

## Timeline at a glance (assuming ~36 h; compress proportionally)

| Hours | MAP | SIM | DATA |
|---|---|---|---|
| 0–2 | Scaffold, deploy | Types, fixture network | Dataset discovery on CKAN, Devpost rules |
| 2–10 | Map, 2D/3D, tool palette | Routing, BPR, engine on the fixture | Network, zones, demand, baseline builds |
| 10–12 | Wire the worker to the map | Load the real network, perf check | Hand off data, start Gemini routes |
| **12** | **Checkpoint: real sim + a closure works · decide the citywide scope** | | |
| 12–20 | Before/after sync, timeline, editors | Interventions, weather, event, rerouting | Gemini scenario + summary, presets |
| **20** | **Checkpoint: the end-to-end demo works on the deploy** | | |
| 20–28 | Results panel, charts, ward overlay, diff mode | Happiness, CO₂, fast-forward, perf | Calibration, Methodology page, domain, share links |
| 28–32 | Polish, onboarding, accessibility | Bug fixes, determinism tests | Demo video, Devpost draft, pitch script |
| **32** | **Feature freeze** | | |
| 32–36 | Rehearse the pitch ×3, final deploy, submit early | | |

---

## Risks and fallbacks

| Risk | Early warning | Fallback |
|---|---|---|
| Citywide sim too slow | Tick > 15 ms at hour 12 | `SIM_BOUNDS` to the old City of Toronto; raise the agent scale factor |
| Centreline topology messy (bad connectivity) | Many disconnected islands after the build | Use OpenStreetMap roads for Toronto (Overpass) for the graph; keep Centreline for names and classes |
| Jobs data not usable | No clean table by hour 6 | Hand-weighted employment centres, documented |
| Count data hard to parse | Not done by hour 8 | A standard AM/PM peak profile shape; calibration becomes a P2 task |
| 3D laggy on judge laptops | < 30 fps | Default to 2D with 3D as a toggle |
| Gemini rate limits or outage | Errors in testing | Cached AI outputs for the preset scenarios; the manual tools always work |
| Venue Wi-Fi fails during judging | — | Local production build on a laptop, plus the pre-recorded video |
| Results look unrealistic | Teammate sanity check fails | Tune capacities and the reroute rate; present the result as directional |
| Looks like a copy of Shift | — | Different purpose (civic, election, before/after evidence) and different stack. Use it as inspiration only; copy no code |

---

## Definition of done

- [ ] A stranger can open the live URL, place a closure, press play and understand the result without help.
- [ ] Before/after runs in sync, with the per-ward happiness, charts and top affected roads.
- [ ] At least 3 preset scenarios that are deterministic and demo-safe.
- [ ] Every number traces back to Toronto Open Data plus documented assumptions on the Methodology page.
- [ ] No partisan content anywhere, including the AI output.
- [ ] Submitted on Devpost with a video, the repo and a live link, at least 1 hour before the deadline.
