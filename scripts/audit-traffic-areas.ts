import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { solveTraffic } from "../src/lib/traffic/solver";
import type { Disruption } from "../src/lib/disruptions";
import type { TrafficData } from "../src/lib/traffic/types";

const data: TrafficData = JSON.parse(readFileSync("public/data/traffic.json", "utf8"));
const areas = [
  ["Union Station", -79.3806, 43.6453], ["Rogers Centre", -79.3894, 43.6414],
  ["Scotiabank Arena", -79.379, 43.6435], ["Yonge-Dundas", -79.3802, 43.6561],
  ["Eaton Centre", -79.3807, 43.6544], ["Kensington Market", -79.4003, 43.6545],
  ["Bloor-Yonge", -79.3868, 43.6709], ["Exhibition Place", -79.415, 43.633],
] as const;
const dist = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 80400, (a[1] - b[1]) * 111200);
const roads = new Map(data.segments.map(r => [r.id, r]));
const results = [];
for (const [name, lng, lat] of areas) {
  const position: [number, number] = [lng, lat];
  const road = [...data.segments].filter(r => /Arterial|Collector/.test(r.cls) && !/Ramp/.test(r.cls)).sort((a, b) => Math.min(...a.coords.map(p => dist(p, position))) - Math.min(...b.coords.map(p => dist(p, position))))[0];
  for (const day of ["weekday", "weekend"] as const) for (const minutes of [480, 1020]) for (const kind of ["closure", "reduction", "event", "combined"] as const) {
    const base = { title: `${name} ${kind}`, position, startsAt: "", endsAt: "", timeZone: "America/Toronto" as const };
    const closure: Disruption = { ...base, id: "road", kind: "accident", roadId: road.id, restriction: kind === "closure" ? "full-closure" : "lane-reduction" };
    const event: Disruption = { ...base, id: "event", kind: "event", attendance: 10000 };
    const items = kind === "combined" ? [closure, event] : kind === "event" ? [event] : [closure];
    const result = solveTraffic(data, items, day, minutes);
    assert.ok(Math.abs(result.totalDemandHourly - result.assignedHourly - result.unassignedHourly) < 1e-6);
    assert.ok(result.converged || result.warning);
    const blocked = new Set(items.flatMap(i => i.kind !== "event" && i.restriction === "full-closure" ? [i.roadId] : []));
    for (const assignment of result.assignments) {
      assert.ok(Math.abs(assignment.demandHourly - assignment.unassignedHourly - assignment.routes.reduce((sum, r) => sum + r.vehiclesHourly, 0)) < 1e-6);
      for (const route of assignment.routes) {
        assert.ok(Number.isFinite(route.travelMinutes) && route.travelMinutes >= 0);
        let endpoints: Set<string> | null = null;
        const node = (p: number[]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
        for (const id of route.roads) {
          assert.ok(!blocked.has(id));
          const s = roads.get(id)!;
          assert.ok(s);
          const first = node(s.coords[0]), last = node(s.coords.at(-1)!);
          const next: Set<string> = new Set();
          if (s.oneway !== -1 && (!endpoints || endpoints.has(first))) next.add(last);
          if (s.oneway !== 1 && (!endpoints || endpoints.has(last))) next.add(first);
          assert.ok(next.size > 0, `Illegal direction/connection in ${name}: ${id}`);
          endpoints = next;
          if (assignment.id === "event") assert.ok(!/Expressway|Ramp/i.test(`${s.cls} ${s.name}`));
        }
      }
    }
    const eventRoutes = result.assignments.filter(a => a.id === "event").flatMap(a => a.routes);
    const usedRoads = eventRoutes.flatMap(r => r.roads.map(id => roads.get(id)!));
    results.push({ area: name, day, minutes, kind, road: road.name, elapsedMs: result.elapsedMs, converged: result.converged, unassignedHourly: result.unassignedHourly, totalDemandHourly: result.totalDemandHourly, affectedRoads: Object.keys(result.impacts).length,
      maxRouteKm: Math.max(0, ...result.assignments.flatMap(a => a.routes.map(r => r.roads.reduce((sum, id) => sum + roads.get(id)!.lengthM, 0) / 1000))),
      eventUsesExpressway: usedRoads.some(r => /Expressway/.test(r.cls)),
      eventApproaches: eventRoutes.map(r => roads.get(r.roads[0])!.name),
      eventDestinationDistanceM: eventRoutes.map(r => {const end = roads.get(r.roads.at(-1)!)!; return Math.min(dist(end.coords[0], position), dist(end.coords.at(-1)!, position));}),
    });
  }
}
writeFileSync(process.argv[2] ?? "reports/traffic-area-audit.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify({ cases: results.length, converged: results.filter(r => r.converged).length, unassignedCases: results.filter(r => r.unassignedHourly > 0).length, longestKm: Math.max(...results.map(r => r.maxRouteKm)), eventExpresswayCases: results.filter(r => r.eventUsesExpressway).length, farthestEventAccessM: Math.max(...results.flatMap(r => r.eventDestinationDistanceM)) }, null, 2));
