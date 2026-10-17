# AI role and Mapbox limits

## What should AI do in the first prototype?

### Takeaway
Use an LLM as an interface to a validated scenario and computational tools. Recommendation: let a reproducible traffic model calculate effects, then have the LLM explain those calculated results.

### Cited Findings
- Gemini supports structured extraction/classification and inputs for tools through a supplied JSON schema, including JavaScript schema validation with Zod. Schema conformance does not establish semantic correctness; application validation remains necessary. — [Google structured output documentation](https://ai.google.dev/gemini-api/docs/structured-output); [Google validation guidance](https://ai.google.dev/gemini-api/docs/generate-content/structured-output)
- Gemini function calling returns proposed function names and arguments; the application executes its own functions and returns their results to the model. This supports grounded computations rather than relying on prose answers for numeric calculations. — [Google function calling documentation](https://ai.google.dev/gemini-api/docs/function-calling)

### Inferences
- Proposed flow: plain-language description → draft scenario → search a real street/intersection index → resolve actual directed segment IDs → validate fields and geographic coverage → show selected roads and editable assumptions → run engine → explain returned results with source/assumption references. These are product recommendations inferred from the capabilities above, not claims about an implemented feature.
- Suggested draft fields: disruption type, directed segment IDs, start/end in America/Toronto, blocked lanes/full closure, event venue and attendance, arrival/departure window, estimated vehicle/transit/walking shares, origin distribution, and an explicit list of missing inputs. Do not allow the LLM to invent segment IDs, traffic counts, lane capacities, or attendance estimates as observed facts.
- Example: “Close King between Bathurst and Spadina on Saturday 4–10 pm for a 5,000-person event” can become a scenario draft. Attendance alone is insufficient to determine cars: attendees × car mode share ÷ vehicle occupancy, plus arrivals over time and destinations, are explicit assumptions to review. This is an accounting recommendation, not a Toronto-calibrated demand formula.
- Require the explanation to use engine output only for delays, affected corridors, rerouted trips, and accessibility differences. Unknown inputs stay unknown or become clearly labelled editable assumptions. No model training is required for this first use of AI.

### Gaps
- No evaluation of the accuracy of a particular Gemini model on Toronto street names, ambiguous place descriptions, time ranges, or disruption extraction was performed. Model choice should follow a small local evaluation of representative scenarios.
- No claim is made that JSON schema or function calling prevents wrong street selection. Segment existence, connectivity, direction, date/time validity and bounds still require deterministic checks.

## Which Mapbox features help, and what do they not simulate?

### Takeaway
Keep Mapbox for rendering and optional traffic-aware route comparisons. A hypothetical disruption simulation still needs its own demand/capacity/network computation or an external simulation engine.

### Cited Findings
- Directions `driving-traffic` uses current/historic conditions. `depart_at` predicts travel times from historic data with live data mixed in near the present. `duration_typical` reports typical conditions for the returned route. Custom `exclude=point(lon lat)` is beta, snaps to a road, and permits up to 50 exclusions. Exclusions are best-effort; inspect violation notifications. — [Directions API](https://docs.mapbox.com/api/navigation/directions/)
- Canada is covered by Mapbox real-time and typical traffic routing. Typical traffic is used when real-time traffic is absent; country coverage does not guarantee observations on every street. — [How Directions services work](https://docs.mapbox.com/help/dive-deeper/directions/)
- Traffic v1 displays real-time congestion and supports Tilequery at a location. Its documented fields include road class, structure, categorical congestion and closed status; traffic updates occur approximately every eight minutes. It supports separate direction styling with line offsets. — [Traffic v1 tileset reference](https://docs.mapbox.com/data/tilesets/reference/mapbox-traffic-v1/)
- Mapbox raw Traffic Data is a distinct licensed product for custom routing, analysis and simulation; access requires a Traffic Data licence and contact with sales. A map access token should not be treated as an entitlement to these files. — [Traffic Data overview](https://docs.mapbox.com/data/traffic/guides/); [Access Traffic Data files](https://docs.mapbox.com/data/traffic/guides/access/)
- Raw Typical data provides directional speed estimates for each five-minute period in a normal week, updated monthly; Live provides recent observed estimates, updated every five minutes. Not all roads have adequate observations. Mapbox recommends Typical data for offline planning and simulation. — [Traffic Data format](https://docs.mapbox.com/data/traffic/guides/data/)

### Inferences
- A route comparison MVP can request a baseline route and another route excluding points on a proposed closed road. Validate the snapped exclusion and response geometry, including violations. This yields an approximate individual-trip detour, not the queues and congestion caused by all displaced traffic.
- Traffic v1 is queryable, so saying its data cannot be queried would be incorrect. However, its documented fields do not supply the complete directed graph, turn permissions, lane capacities or origin-destination demand required by a network simulation. Treat it as an observed-condition layer rather than a directly editable simulation engine.
- No reviewed Directions parameter supplies “5,000 event visitors”, lane capacity changes, intersection signal changes or a citywide set of rerouted demands. Updating an overlay or excluding points does not make Mapbox recompute hypothetical congestion in neighbouring streets. This is an inference from the documented API surface, not a claim about all possible private Mapbox services.
- For baseline/simulation comparisons, use the same departure-time assumption. Do not present a live-current route versus a normal-week simulated future route as a clean causal effect of the disruption.

### Gaps
- Exact Toronto street-level coverage, licences, allowed storage/use and commercial cost require further product/contract checks before relying on raw data. No raw Toronto Traffic Data files were obtained.
- No API calls were made using the user's token; these are documented capabilities, not verified end-to-end route results.

## Should we train a traffic AI model now?

### Takeaway
Recommendation: defer custom traffic ML. Build and validate a transparent disruption model first; later ML can forecast baselines or approximate an already calibrated simulator if sufficient representative data exists.

### Cited Findings
- DCRNN models spatial and temporal dependencies on a directed traffic graph and evaluates traffic forecasting on real-world road-network datasets. Its published task is data-driven forecasting, not proof of causal effects of arbitrary Toronto interventions. — [DCRNN paper](https://arxiv.org/abs/1707.01926)
- Traffic forecasting research explicitly identifies extreme and anomalous events as difficult; CompFormer studies this with observed traffic benchmarks. Performance on forecasting benchmarks does not establish reliable impact prediction for an unseen closure/event configuration. — [Test-Time Compensated Representation Learning for Extreme Traffic Forecasting](https://arxiv.org/abs/2309.09074)

### Inferences
- Road geometry plus accident locations is insufficient training data for credible delay predictions. A useful supervised dataset would need time-aligned speeds/counts, background demand, disruption location and extent, start/end/clearance, weather/calendar/context, and observed before/during/after outcomes. Distinguish measured outcomes from synthetic simulation output.
- Test on held-out dates and disruption cases, report error against a simple baseline, and avoid random splits that put near-identical times/segments from one event in both training and evaluation. This is a recommended evaluation design, not a finding about a dataset already acquired.
- A surrogate trained on simulator runs may accelerate that simulator, but inherits its assumptions and calibration errors. Validate the underlying simulator against real observations before describing its surrogate as a real-world predictor.
- For the hackathon, use “estimated scenario impact under these assumptions” and comparisons between alternatives. Do not label LLM-generated plausible numbers as predictions or measured city outcomes.

### Gaps
- No Toronto dataset combining comprehensive disruption labels, representative demand and matching high-frequency speed/flow observations was established in this subtask. The parallel Toronto data investigation may identify candidate inputs, but their suitability still needs assessment.
- No evidence supports a specific accuracy claim, exact projected delay or event-to-congestion coefficient for this app at present.
