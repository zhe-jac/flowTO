# Movement queues and stable detours

The previous solver used one FIFO queue per directed road and chose detours one junction at a time. A blocked turn could prevent unrelated movements on the same road, and route decisions could combine current edge costs with an older distance tree.

The updated solver uses finite storage and FIFO ordering per assumed lane. Left and right turns use the outer lanes based on road entry/exit bearings; through movements can use available lanes. A single-lane road still shares one queue. Queued vehicles may change into a compatible lane when storage permits, with a limited transfer rate. These assignments are assumptions, not surveyed lane markings.

Detours are complete connected paths computed from consistent 30-second cost snapshots. Routes avoid closed links, immediate reversals on the same road and previously visited nodes. Discretionary changes require extra congestion relative to the matching baseline, a 60-second cooldown and savings of at least 30 seconds or 20%, whichever is greater. Closures force reconsideration immediately. New departures reconsider their original corridor when restrictions change. Vehicles remain accounted for while waiting or changing lanes.

## Fixed-network comparison

Run on October 18, 2026 using the bundled data, clear weather and Sunday demand. Restrictions start at 12:15: King and Adelaide from University to Yonge are full closures; University from Richmond to Wellington is a lane reduction. The latter reproduces the construction marker in the screenshot. The exact third extent and lane setting were not supplied, so this is an approximate reproduction.

All cases use the same 1,215 directed edges, 1,007 inferred trip streams, demand, capacity assumptions, five-second steps, 30-minute warmup and observation window. Each engine computes its own matching unrestricted baseline. No demand multiplier or congestion-colour threshold was changed.

A severely slow open direction has speed below 25% of its assumed uncongested speed. Closed directions are excluded from this metric. Additional queued vehicles sum positive scenario-minus-baseline differences across directed edges.

| Restriction | Severe open directions after 60 min, previous → updated | Additional queued vehicles after 60 min, previous → updated |
| --- | ---: | ---: |
| None | 33 → 28 | 0 → 0 |
| King | 179 → 37 | 2,754 → 104 |
| Adelaide | 214 → 37 | 3,767 → 208 |
| University lane reduction | 123 → 28 | 1,879 → 23 |
| All three | 312 → 61 | 5,227 → 506 |

When all restrictions instead end after 30 minutes, additional queued vehicles at minute 120 fall from 12,256 to 112. The updated scenario then has 44 severely slow open directions against its matching baseline's 43. Recovery is substantial without deleting the remaining queues or pending trips.

Sustained restrictions still produce substantial congestion: at minute 120, as the originally scheduled restrictions clear, the updated run has 280 severely slow open directions and 4,234 additional queued vehicles. This does not establish whether their magnitude is realistic.

Maximum vehicle-balance error across these runs was below 0.000001 vehicles; lane storage did not overflow beyond floating-point tolerance. Updated 165-minute benchmark runs took approximately 7.5–8.8 seconds on this machine, compared with approximately 0.9–3.6 seconds previously. Work remains in background Node workers rather than the map rendering thread.

## Reproduction and limits

Run `corepack pnpm exec tsx scripts/benchmark-traffic-solver.ts` for the current checks. Optional positional arguments are a reference engine module path and a JSON output path. The reference for this comparison was the unchanged engine copied before this work.

Regression tests cover independent and shared lanes, complete detours, visited-node avoidance, immutable route-cost snapshots, unrelated baseline congestion, lane changes, event accounting and reopening. Existing conservation, storage, direction and closure-timing checks remain in place.

These checks establish software behavior and sensitivity. They do not calibrate demand, origins and destinations, lane markings, legal turn prohibitions, signal timing, network boundaries or observed speeds. Those remain necessary before treating these results as reliable traffic forecasts.
