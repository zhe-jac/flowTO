# Local traffic solver validation

The rerouting endpoint now uses `solveTraffic` exclusively. It makes no external
model request and does not require a Gemini credential. Future conversational AI
integration is separate from this change.

Validation run:

- 567 automated tests passed, including 500 seeded varied scenarios: 300 synthetic
  networks and 200 using the bundled Toronto network.
- Checked road existence, directed route continuity, one-way rules, closure
  avoidance, finite nonnegative results, per-demand conservation, and consistency
  between route loads and road impacts.
- Additional cases cover empty/reset scenarios, duplicate IDs, unknown roads,
  overlapping restrictions, unreachable demand, events with no nearby approach,
  capacity-sensitive distribution, iteration limits, determinism, and 20
  simultaneous Toronto disruptions.
- API tests forbid external fetches, verify solver-only output and caching, and
  exercise invalid input and the 20-disruption limit.
- TypeScript and production build passed.
- Headless Edge confirmed that placing a 5,000-attendee event produced a
  solver-only response (181 ms), displayed local rerouting status, and that Reset
  cleared the scenario.

486 of the 500 varied cases converged to the configured route-share tolerance.
The other 14 hit the 100-iteration bound and returned their current assignment
with an explicit warning; they still passed route validity and demand accounting.
This distinction is deliberate: bounded runtime does not imply convergence.

In the full regression run on this laptop, 200 Toronto cases took a median of
148 ms, p95 of 268 ms, and maximum of 465 ms. These include candidate route
generation and assignment, but exclude HTTP, browser rendering, and first data
file loading. Timings depend on hardware, background load, and disruption count.

Reproduce with `pnpm test`; run only the 500-scenario validation with
`pnpm exec tsx --test src/lib/traffic/solver.test.ts`.

These tests establish software consistency, not predictive accuracy against
observed Toronto diversions. The solver is a static approximation over a bounded
candidate set; it does not model physical queues, turn restrictions, signals,
origin/destination demand, or exact directional assignment on two-way roads.

## Before/After consistency audit

The follow-up regression suite passes 571 tests. Added tests check that Before
always uses baseline, mature disruptions cannot accelerate new ones, scheduled
inactive disruptions contribute nothing, and immediate closures agree with road
details. All 500 solver scenarios also verify that per-disruption contributions
recombine into the full assignment.

The map and road panel now share the same effective impacts. The independent
congestion-colour wave was removed because it could disagree with calculated
speeds and occupancy. The 45-minute per-disruption buildup remains. Only active
disruptions enter the solver, and demand refreshes at 15-minute profile intervals.

A paused browser event scenario at 18:00 returned 63,186 vehicles in Before and
63,300 in After; switching back to After returned exactly 63,300 again. Occupancy
is vehicles currently on roads, not the sum of hourly route demand or unique
trips, so it need not stay constant when detours add distance or reduce speed.
