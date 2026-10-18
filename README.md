# Toronto Traffic Sandbox

**See what road closures, construction, events and weather do to Toronto traffic, before they happen.**

Place a disruption on a map of Toronto, and the sandbox simulates how traffic diverts, where queues form and how long the city takes to recover, compared with a normal day.

Built for Hack the Valley 2026 (Hack the Valley x School of Cities track). It tests plans and policies, not candidates: there are no election predictions or voting recommendations.

## What it does

- **Citywide traffic map:** about 43,000 Toronto road segments, coloured by estimated congestion, in 2D or 3D, with day/night lighting.
- **Disruption toolbox:** drag a road closure, lane reduction, accident, construction zone or event onto the map, with optional times.
- **Traffic simulation:** a local network solver reroutes trips, builds queues, spills back onto nearby streets and recovers after a disruption ends.
- **Before/After:** compare the scenario with a normal day at any time.
- **Time controls:** pick a date, play at different speeds, or follow the current Toronto time.
- **Weather:** live Toronto conditions or manual rain and snow, which slow traffic.
- **Assistant (Gemini):** describe a disruption in plain English ("Close Queen St W from Spadina to University, 5–7 PM") and get explanations grounded in the simulated results.
- **Street info:** click any road for its volume, speed, queue and the City count behind it.

## How it works

- **Traffic volumes** come from City of Toronto counts (midblock and intersection), merged across years and adjusted to recent levels. Uncounted roads borrow nearby counts on the same street or use typical values for their road type.
- **Demand context** includes employment hubs and published Blue Jays home games.
- **The simulation** runs on the server in a Node worker. It keeps track of every vehicle (on the road, queued or still waiting to leave), respects road storage, and updates route costs each simulated minute. The map plays back its results.
- **Gemini** is optional. It turns text into proposed disruptions and explains results, but it doesn't produce the traffic numbers.

## Getting started

Requirements: Node.js 22+ and pnpm 9 (or `corepack pnpm`).

```sh
corepack pnpm install
cp .env.example .env.local   # then add your keys
corepack pnpm dev            # http://localhost:3000
```

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Mapbox map with 3D buildings (without it, a free MapLibre map is used) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | The assistant (server-only; the simulation works without it) |

The simulation needs a long-running Node server (`pnpm dev` or `pnpm start`), not serverless functions.

| Script | What it does |
|---|---|
| `pnpm dev` / `build` / `start` | Develop, build and serve |
| `pnpm test` / `check` | Run tests and the TypeScript check |
| `pnpm data:traffic` | Rebuild traffic volumes from City data (cached in `data/raw/`) |
| `pnpm data:traffic-topology` | Rebuild road junction links for the simulation |
| `pnpm data:events` | Refresh the Blue Jays home-game schedule |
| `pnpm data:boundary` | Rebuild the Toronto boundary and edge fade |

## Data

[City of Toronto Open Data](https://open.toronto.ca/) (Centreline, traffic counts, boundary) under the Open Government Licence – Toronto; MLB schedule; [Open-Meteo](https://open-meteo.com/) weather; © Mapbox and © OpenStreetMap contributors.

## Limitations

Results are illustrative estimates, not forecasts:
- Trips are inferred from road counts, not measured origins and destinations.
- Lanes and capacities are assumed by road type.
- Turn restrictions and signal timing aren't modelled.
- Some counts are old.

Use the Before/After comparison to judge relative effects rather than exact minutes.

See [ROADMAP.md](ROADMAP.md) for what's planned next.

## Team

A team of three at Hack the Valley 2026. Code licence: MIT (a `LICENSE` file is still to be added). Data and map assets keep their own licences.
