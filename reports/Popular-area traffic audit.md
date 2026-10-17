# Popular-area traffic audit

128 scenarios cover eight approximate area locations: Union Station, Rogers
Centre, Scotiabank Arena, Yonge-Dundas, Eaton Centre, Kensington Market,
Bloor-Yonge, and Exhibition Place. These are road-network access estimates, not
verified venue entrances.

Each location has 16 cases: weekday/weekend, 08:00/17:00, and full closure,
lane reduction, 10,000-attendee event, or combined event plus lane reduction.
The nearby closure road is selected from arterials/collectors in bundled data.

The initial audit found two modeling weaknesses and one search issue:

- Selecting event approaches purely by historical volume over-selected nearby
  expressways. Arrivals now use distinct surface streets from surrounding
  quadrants, with scoring that considers distance and the selected day type.
  Surface-only arrival paths represent the last local approach, not the entire
  visitor trip. The venue snaps to a nearby endpoint with incoming connections,
  considering both ends of road segments rather than only their first point.
- Lane reductions were unavailable to other diversions. They now remain open
  with reduced capacity; a disruption's own diverted demand still avoids its
  restricted segment. Fully closed roads remain unavailable to every route.
- A path could be returned when the search limit interrupted Dijkstra before
  finalizing the destination. Routes now require a finalized destination. A
  binary-heap priority queue allows a larger 10,000-node bound without scanning
  the whole frontier, recovering the tested longer waterfront detours.

After these changes, all 128 cases converged and none had unassigned demand.
Automated assertions checked directed continuity, one-way rules, closure
avoidance, demand accounting, finite travel times, convergence reporting, and
surface-only event approaches. The 128 cases took at most 192 ms each in this
run; other hardware and scenarios can take longer.

| Area | Cases converged | Longest candidate route, km |
|---|---:|---:|
| Union Station | 16/16 | 1.99 |
| Rogers Centre | 16/16 | 1.74 |
| Scotiabank Arena | 16/16 | 1.09 |
| Yonge-Dundas | 16/16 | 1.23 |
| Eaton Centre | 16/16 | 1.21 |
| Kensington Market | 16/16 | 2.36 |
| Bloor-Yonge | 16/16 | 1.77 |
| Exhibition Place | 16/16 | 5.98 |

The Exhibition Place case illustrates that removing a short waterfront link
can require a much longer directed detour; route lengths were not forcibly
shortened to make the map look better. Candidate lengths are not evidence that
drivers would actually choose those routes.

Reproduce: `pnpm exec tsx scripts/audit-traffic-areas.ts`. Detailed results are
written to `reports/traffic-area-audit.json`. The full `pnpm test` suite also
checks 500 varied network scenarios and the shared Before/After calculations.

The browser comparison remains repeatable: a paused event test returned 63,186
vehicles in Before and 63,282 in After, including the same After total after
toggling back. These are occupancy estimates, not unique trip counts.

This audit checks plausibility and software invariants. It does not validate
real-world diversion accuracy, venue parking access, legal turning restrictions,
road closures absent from the dataset, transit mode share, or physical queues.
