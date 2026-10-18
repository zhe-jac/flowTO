# Traffic simulation implementation

The map uses the finite-storage-v2 worker rather than the legacy static rerouting endpoint. Synthetic connected trips are inferred from historical directional link totals using Centreline junction IDs and one-way streets. Lane counts, movement assignments, signal capacity and event driving shares are assumptions.

Vehicles use finite FIFO storage per assumed lane. Left turns use the leftmost lane, right turns use the rightmost, and through movements can use available lanes, based on road entry and exit bearings. Compatible lane changes are limited by space and throughput. Full closures prevent entry while vehicles already on a segment can leave; overlapping restrictions apply the strongest capacity reduction.

Complete routes avoid closed links, immediate road reversals and previously visited nodes. Routing snapshots update every 30 simulated seconds. Optional reroutes require additional delay relative to the matching baseline, a 60-second cooldown, and travel-cost savings of at least 30 seconds or 20%, whichever is greater. New closures override the cooldown, and new departures reconsider their original corridor when restrictions change.

Baseline and scenario runs conserve generated, completed, on-road and pending vehicles. Five-second simulation steps produce compact one-minute frames. Road colours, flow animation, vehicle stock and street details sample the same state. Before uses the matched simulation baseline. Whole directional ribbons remain separate from crossing streets; additional queues or speed loss increase width and saturation in After. Affected ribbons use whole congestion levels while their colour and emphasis can transition over time. Manual seeking snaps colour, width and dimming to the selected state.

Placement, editing and pending calculations pause playback. Play remains blocked with a dismissible message until processing is ready. Saved disruptions disappear from road overlays, markers and models outside their schedule; an editing draft remains available. Removing an item preserves its ended operation for recovery. Reset clears the scenario history.

The server runs at most two workers. Superseded requests release their ownership, and workers with no remaining owners are cancelled. Identical requests can share a worker. Additional requests queue, and temporary capacity responses retry automatically.

The browser retains completed windows for the current scenario. Already calculated times, including overlapping windows, retain their first completed result when moving forward and rewinding. Disruption edits, weather changes and Reset invalidate that cache. This cache lasts for the mounted browser session. Uncalculated periods still require a worker run; background lookahead and continuation from vehicle-state checkpoints are not implemented.

Runs cover affected streets plus a buffer, up to 6,500 directed links, and produce 150 minutes of output. New windows replay earlier history with a six-hour maximum. Long restrictions may therefore have approximate prior backlogs. Absolute congestion and recovery remain uncalibrated, and inferred demand, local network boundaries, assumed lanes, missing legal turn restrictions and missing observed signal timing limit the results.

Run `corepack pnpm exec tsx scripts/benchmark-traffic-solver.ts` for fixed-network King, Adelaide and University checks. Optional positional arguments supply a reference engine module and a JSON output path. See [the recorded solver comparison](../reports/traffic-solver-v2-check.md) for measured software behavior and limitations.
