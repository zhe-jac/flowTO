# Practical traffic simulation approaches

## Which engine is achievable for the downtown prototype?

### Takeaway

Start with deterministic closures and directed-graph rerouting. Add transparent demand and capacity assumptions for an approximate congestion comparison. Use an external SUMO service only when time-dependent queues, incident clearance and spillback become core requirements; Mapbox is the renderer, not the traffic engine.

### Cited Findings

- SUMO documents Dijkstra/A* shortest or fastest paths as the simplest route calculation, but warns that assigning everybody to the initially fastest route can create bottleneck jams. Its iterative assignment alternates routing with simulated travel times. Its macroscopic `marouter` instead uses mathematical volume-delay functions without microscopic simulation. — [SUMO Dynamic User Assignment](https://sumo.dlr.de/docs/Demand/Dynamic_User_Assignment.html)
- FHWA identifies BPR curves as common static assignment functions and explicitly states that they do not project congestion spillback onto upstream links. — [FHWA Multiresolution Modeling Case Studies, 2022](https://www.fhwa.dot.gov/publications/research/operations/22054/22054.pdf)
- SUMO's mesoscopic model runs from the command line with a network and routes, uses finite traffic queues and downstream queue states, and shares inputs with the microscopic engine. The documentation describes more detailed urban queue dynamics through its mesoscopic Link Transmission Model; mesoscopic lane changing is not explicit. The default mesoscopic junction control is off and needs deliberate configuration for urban junctions. — [SUMO Meso](https://sumo.dlr.de/docs/Simulation/Meso.html)
- Python TraCI can launch and step a SUMO process, retrieve subscribed variables, change simulation state and convert simulation coordinates to geographic coordinates. SUMO recommends its compatible `libsumo` API when a GUI is unnecessary and performance matters. — [SUMO Python interface](https://sumo.dlr.de/docs/TraCI/Interfacing_TraCI_from_Python.html)
- CityFlow describes itself as a microscopic, multithreaded traffic simulator with a Python interface for multi-agent reinforcement learning. Its roadnet requires directional roads, intersections, road links and lane links. Its flow file requires vehicle parameters, routes, departure intervals and start/end times. — [CityFlow Introduction](https://cityflow.readthedocs.io/en/latest/introduction.html), [Roadnet](https://cityflow.readthedocs.io/en/latest/roadnet.html), [Flow format](https://cityflow.readthedocs.io/en/latest/flow.html)

### Inferences

- Recommended first stage: prepare a connected, directed downtown network; select an origin/destination pair; disable a road segment; calculate the legal detour; display extra distance and travel time under stated edge speeds. This is useful before any citywide traffic model exists.
- Recommended second stage: use time-binned baseline OD demand, allocate trips among alternative paths, update edge costs with an explicitly approximate capacity-delay function, and compare baseline with disruption. Call results estimated traffic pressure/delay, not measured traffic or queue length. A Web Worker can keep this calculation off the React thread.
- A BPR travel-time formula and time slider do not create a dynamic queue model. True spillback needs storage limits, upstream/downstream flow constraints and temporal vehicle conservation, or an established engine that implements those dynamics.
- SUMO saves implementing traffic dynamics and incident controls. It does not save network cleaning, demand estimation or calibration. For a small team, adopting it for only closure detours is unnecessary infrastructure.
- A SUMO architecture would run a separate Python worker/container or batch job, accept a validated scenario, and return per-road/per-time results for Mapbox. It is not a Mapbox plugin or a browser package. Do not assume the current Next.js route/serverless deployment can host long-running native processes; choose a suitable worker host or precompute demo runs. This is an architectural inference from the documented CLI and process-controlled interface, not a measured deployment benchmark.
- CityFlow is a reasonable research option for traffic-signal RL, but its setup demands and focus offer no demonstrated shortcut for this closure/event product. Prefer SUMO if an external engine becomes necessary.

### Gaps

- No local runtime benchmark or validated downtown Toronto network was produced. No assertion that either engine runs interactively at the eventual city scale is justified yet.
- Native closure and incident controls were verified in SUMO documentation; equivalent CityFlow controls were not verified during this bounded review.

## How should closures, accidents and events change the model?

### Takeaway

All three are structured changes to supply, demand and time. A closure removes permitted capacity, an incident temporarily reduces capacity or speed, and an event adds time-distributed trips while possibly closing streets. AI can collect these inputs, but numerical effects should come from the model.

### Cited Findings

- SUMO supports time-interval edge closures and lane closures. Restrictions can forbid vehicle classes; hard restrictions differ from merely discouraging routes. If no legal detour exists, affected vehicles may wait until reopening. Incorrect restriction/routing-mode combinations can cause errors or loops, so implementation needs explicit tests. — [SUMO Rerouter](https://sumo.dlr.de/docs/Simulation/Rerouter.html)
- SUMO can recompute a route through `rerouteTraveltime`, or compute a route with `findRoute` and apply it through `setRoute`; temporary road permissions are supported for construction-like obstructions. — [SUMO Routing](https://sumo.dlr.de/docs/Simulation/Routing.html)
- FHWA characterizes incidents as capacity losses and diversions; planned events can both generate new trips and close lanes or roads for staging. — [FHWA Event Handbook, Chapter 1](https://ops.fhwa.dot.gov/publications/fhwaop04010/chapter1.htm)
- FHWA's event-demand procedure uses attendance, automobile mode share and vehicle occupancy to calculate vehicle trips. Arrival/departure profiles, directional origins, parking/access capacity, lane assignments and signal programs also matter; event estimates should consider local conditions and similar-event observations. — [FHWA Event Handbook, Chapter 5](https://ops.fhwa.dot.gov/publications/fhwaop04010/chapter5_03.htm)
- FHWA distinguishes long-term work-zone route learning from short-term incident reactions; for unexpected incidents, en-route information and diversion assumptions are relevant. — [FHWA DTA Fundamentals](https://ops.fhwa.dot.gov/publications/fhwahop13015/sec2.htm)

### Inferences

- Closure scenario: road IDs, direction, affected lanes/classes, start, end, and permitted turns. For a full closure, remove the edge from legal routing rather than merely applying an arbitrary delay. Report disconnected trips instead of inventing a detour.
- Accident scenario: selected edge and direction, blocked lanes, severity/capacity multiplier, speed restriction, onset and clearance time; optionally staged restoration. Treat capacity multipliers and clearance times as editable assumptions, not inferred truths. Simulate operational consequences of an incident; predicting where an accident occurs is a different task.
- Accident lane loss is not necessarily proportional to lanes lost: merging, rubbernecking and junction interactions may amplify effects. Without local calibration, offer low/medium/high severity ranges rather than a single authoritative percentage.
- Event scenario: venue, attendance, arrival/departure windows, mode shares, car occupancy, origin distribution, parking/drop-off access and any staging closures. Compute car arrivals approximately as attendees × car share ÷ occupancy, then distribute across origins, access points and time bins. Model departures separately. Taxi/ride-hail circulation can require additional trip legs; it should not silently be treated as parked private cars.
- For a first scenario, choose a known downtown venue plus one nearby closure, compare identical baseline demand with the event/closure case, and show changed detours, roads under pressure, affected TTC routes and estimated delay ranges. Reuse the same random seed if stochastic demand is introduced.
- An LLM may translate “close this street for a 5,000-person event from 5–9 PM” into a validated scenario form and explain model outputs. It should not invent precise congestion percentages or missing attendance, mode shares, capacity and clearance observations. Leave missing inputs visible and editable.

### Gaps

- These sources provide methods, not Toronto-specific accident-capacity factors, event mode shares or venue arrival profiles. Those inputs require local data or clearly labeled assumptions.
- Transit crowding and passenger transfer delay require additional schedule, demand and service-capacity modeling; road rerouting alone does not supply them.

## What inputs and validation are required before calling this realistic?

### Takeaway

The largest risk is believable visuals driven by an uncalibrated baseline. Build the baseline first and preserve assumptions/provenance. Road geometry and live incident locations alone do not describe where or when all travellers wish to go.

### Cited Findings

- SUMO imports OSM through `netconvert`, but documents missing speeds and ramps, guessed lane-to-lane connections, junction merging problems and signal interpretation errors. It specifically warns that unsynchronized controllers or badly represented junction clusters can create artificial jams/deadlocks. Shared streetcar/road space also needs correct conversion. — [SUMO OSM import](https://sumo.dlr.de/docs/Networks/Import/OpenStreetMap.html)
- SUMO accepts OD matrices, flows, turning ratios and detector observations as demand sources. Its documentation warns that randomized trips without measurements produce highly unrealistic results. — [SUMO Demand Modeling Introduction](https://sumo.dlr.de/daily/userdoc/Demand/Introduction_to_demand_modeling_in_SUMO.html)
- FHWA recommends model bounds include significant alternate routes and the extent of congestion; model time must include buildup and dissipation. Calibration compares model performance with observations, then validation uses a different dataset. Combining incompatible observation days can create unrealistic congestion. — [FHWA DTA Modeling Framework](https://ops.fhwa.dot.gov/publications/fhwahop13015/sec4.htm)

### Inferences

- Minimum topology: persistent road/edge IDs, directed connectivity, one-way rules, legal turns, segment length, speed, lane count, mode permissions and capacity assumptions. A display-only centreline dataset may need repair/enrichment before being a routing network.
- Minimum demand: origin/destination zones or entry/exit gateways with departure-time volumes. Link counts constrain demand but do not uniquely reveal the complete OD matrix. Treat reconstructed demand as an estimate.
- For dynamic intersection queues: add signal phase/green timing, turning demand, lane/turn allocation, storage lengths and discharge assumptions. Include TTC streetcars/shared rights of way when relevant rather than allowing them to pass through traffic unimpeded.
- Downtown-first should include a buffer with plausible alternate corridors and gateway inflows, not just trim the model at the display viewport. The camera's Toronto boundary is a presentation constraint; simulation boundaries should be chosen for traffic validity.
- Validate in layers: connectivity/turn legality; baseline counts and travel times; expected queue locations/timing if modeled; one held-out closure/event if available. Show input date, measured versus assumed fields, demand range and sensitivity. Avoid precision in outputs beyond the evidence.

### Gaps

- Availability, granularity and licensing of Toronto baseline traffic counts, travel-time observations, signal plans and OD information are covered by the separate data-source investigation. This review did not establish those datasets are sufficient for calibrated prediction.
