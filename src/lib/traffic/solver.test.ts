import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, after } from "node:test";
import type { Disruption } from "../disruptions";
import { solveTraffic, type SolverResult } from "./solver";
import type { TrafficData, TrafficSegment } from "./types";

let seed = 417;
const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6 * Math.max(1, a, b), `${a} != ${b}`);
const node = (p: number[]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
function road(id: string, a: number[], b: number[]): TrafficSegment {
  return { id, coords: [a, b], name: id, cls: random() < 0.5 ? "Local" : "Major Arterial", oneway: random() < 0.7 ? 0 : random() < 0.5 ? 1 : -1, lengthM: 100 + random() * 600, weekdayDaily: 500 + random() * 60000, weekendDaily: 500 + random() * 20000, source: { kind: "class" } };
}
function grid(): TrafficData {
  const segments: TrafficSegment[] = [];
  for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
    const a = [-79.39 + x * 0.002, 43.65 + y * 0.002];
    if (x < 3) segments.push(road(String(segments.length), a, [a[0] + 0.002, a[1]]));
    if (y < 3) segments.push(road(String(segments.length), a, [a[0], a[1] + 0.002]));
  }
  return { segments, profiles: { weekday: Array(96).fill(1 / 96), weekend: Array(96).fill(1 / 96) } } as TrafficData;
}
function disruption(road: TrafficSegment, id: string, kind: Disruption["kind"]): Disruption {
  const base = { id, title: kind, position: road.coords[0] as [number, number], startsAt: "", endsAt: "", timeZone: "America/Toronto" as const };
  return kind === "event" ? { ...base, kind, attendance: random() < 0.2 ? null : Math.floor(random() * 50000) } : { ...base, kind, roadId: road.id, restriction: random() < 0.7 ? "full-closure" : "lane-reduction" };
}
function check(data: TrafficData, items: Disruption[], result: SolverResult) {
  const roads = new Map(data.segments.map(r => [r.id, r]));
  const closed = new Set(items.flatMap(i => i.kind !== "event" && i.restriction === "full-closure" ? [i.roadId] : []));
  close(result.totalDemandHourly, result.assignedHourly + result.unassignedHourly);
  assert.ok(result.iterations <= 100);
  assert.ok(Number.isFinite(result.residual));
  if (result.converged) assert.ok(result.residual <= 0.01);
  const totals = new Map<string, number>();
  for (const assignment of result.assignments) {
    close(assignment.demandHourly, assignment.unassignedHourly + assignment.routes.reduce((sum, r) => sum + r.vehiclesHourly, 0));
    for (const route of assignment.routes) {
      assert.ok(route.roads.length > 0);
      assert.ok(Number.isFinite(route.vehiclesHourly) && route.vehiclesHourly >= 0);
      assert.ok(Number.isFinite(route.travelMinutes) && route.travelMinutes >= 0);
      let ends: Set<string> | null = null;
      for (const id of route.roads) {
        assert.ok(!closed.has(id));
        const road = roads.get(id)!;
        assert.ok(road);
        const a = node(road.coords[0]), b = node(road.coords.at(-1)!);
        const next: Set<string> = new Set();
        if (road.oneway !== -1 && (!ends || ends.has(a))) next.add(b);
        if (road.oneway !== 1 && (!ends || ends.has(b))) next.add(a);
        assert.ok(next.size > 0, `Disconnected or wrong-way route at ${id}`);
        ends = next;
        totals.set(id, (totals.get(id) ?? 0) + route.vehiclesHourly);
      }
    }
  }
  for (const [id, impact] of Object.entries(result.impacts)) {
    assert.ok(roads.has(id));
    assert.ok(Object.values(impact).every(Number.isFinite));
    assert.ok(impact.retained >= 0 && impact.retained <= 1);
    assert.ok(impact.capacityScale >= 0 && impact.capacityScale <= 1);
    assert.ok(impact.addedHourly >= 0);
    close(impact.addedHourly, totals.get(id) ?? 0);
    const contributions = Object.values(result.perDisruption ?? {}).flatMap(part => part[id] ? [part[id]] : []);
    close(impact.addedHourly, contributions.reduce((sum, part) => sum + part.addedHourly, 0));
    close(impact.retained, Math.min(1, ...contributions.map(part => part.retained)));
    close(impact.capacityScale, Math.min(1, ...contributions.map(part => part.capacityScale)));
  }
  for (const id of closed) { assert.equal(result.impacts[id].retained, 0); assert.equal(result.impacts[id].addedHourly, 0); }
}

const real: TrafficData = JSON.parse(readFileSync("public/data/traffic.json", "utf8"));
const downtown = real.segments.filter(r => r.coords[0][0] > -79.435 && r.coords[0][0] < -79.345 && r.coords[0][1] > 43.63 && r.coords[0][1] < 43.685);
const durations: number[] = [];
let converged = 0;
for (let index = 0; index < 500; index++) {
  const data = index < 300 ? grid() : real;
  const pool = index < 300 || index % 2 ? data.segments : downtown;
  const count = 1 + index % 4;
  const kinds = ["closure", "accident", "construction", "event"] as const;
  const items = Array.from({ length: count }, (_, j) => disruption(pool[Math.floor(random() * pool.length)], `case-${index}-${j}`, kinds[(index + j) % 4]));
  const day = index % 2 ? "weekday" : "weekend";
  const minutes = index * 73 % 1440;
  test(`solver scenario ${index + 1}: ${index < 300 ? "synthetic network" : "Toronto"}, ${count} disruption(s), ${day}`, () => {
    const result = solveTraffic(data, items, day, minutes);
    check(data, items, result);
    if (index >= 300) durations.push(result.elapsedMs!);
    if (result.converged) converged++;
    if (index % 50 === 0) {
      const second = solveTraffic(data, items, day, minutes);
      assert.deepEqual(result.impacts, second.impacts);
      assert.deepEqual(result.assignments, second.assignments);
    }
  });
}
test("empty, overlapping, isolated, and invalid scenarios", () => {
  const data = grid(), item = disruption(data.segments[0], "first", "closure");
  assert.equal(Object.keys(solveTraffic(data, [], "weekday", 0).impacts).length, 0);
  const full = { ...item, kind: "closure" as const, roadId: data.segments[0].id, restriction: "full-closure" as const };
  close(solveTraffic(data, [full], "weekday", 480).totalDemandHourly, solveTraffic(data, [full, { ...full, id: "second" }], "weekday", 480).totalDemandHourly);
  assert.throws(() => solveTraffic(data, [full, full], "weekday", 480));
  assert.throws(() => solveTraffic(data, [{ ...full, roadId: "missing" }], "weekday", 480));
  assert.throws(() => solveTraffic(data, [], "weekday", NaN));
  assert.throws(() => solveTraffic(data, [], "weekday", 480, { maxIterations: 0 }));
  const isolated = { ...data, segments: [data.segments[0]] };
  const result = solveTraffic(isolated, [full], "weekday", 480);
  assert.equal(result.assignedHourly, 0);
  assert.equal(result.unassignedHourly, result.totalDemandHourly);
  const event: Disruption = { id: "far", kind: "event", title: "Event", position: [-79.6, 43.8], attendance: 1000, startsAt: "", endsAt: "", timeZone: "America/Toronto" };
  assert.equal(solveTraffic(isolated, [event], "weekday", 480).unassignedHourly, 300);
});
test("capacity-aware assignment sends more diverted traffic down the higher-capacity route", () => {
  const a = [-79.38, 43.65], b = [-79.37, 43.65], c = [-79.38, 43.66], d = [-79.38, 43.64];
  const make = (id: string, from: number[], to: number[], cls: string, daily = 100): TrafficSegment => ({ id, coords: [from, to], name: id, cls, oneway: 1, lengthM: 500, weekdayDaily: daily, weekendDaily: daily, source: { kind: "class" } });
  const data = { profiles: { weekday: Array(96).fill(1 / 96), weekend: Array(96).fill(1 / 96) }, segments: [make("closed", a, b, "Local", 96000), make("small1", a, c, "Local"), make("small2", c, b, "Local"), make("large1", a, d, "Major Arterial"), make("large2", d, b, "Major Arterial")] } as TrafficData;
  const item: Disruption = { ...disruption(data.segments[0], "capacity", "closure"), kind: "closure", roadId: "closed", restriction: "full-closure" };
  const result = solveTraffic(data, [item], "weekday", 480);
  assert.ok(result.impacts.large1.addedHourly > result.impacts.small1.addedHourly);
  close(result.impacts.large1.addedHourly + result.impacts.small1.addedHourly, 4000);
  check(data, [item], result);
  const limited = solveTraffic(data, [item], "weekday", 480, { maxIterations: 1, tolerance: 1e-10 });
  assert.equal(limited.converged, false);
  assert.match(limited.warning!, /iteration limit/);
});
test("twenty simultaneous Toronto disruptions preserve demand and input data", () => {
  const items = Array.from({ length: 20 }, (_, i) => disruption(downtown[i * 11], `stress-${i}`, i % 5 === 0 ? "event" : "closure"));
  const before = JSON.stringify(items);
  const result = solveTraffic(real, items, "weekday", 1020);
  check(real, items, result);
  assert.equal(JSON.stringify(items), before);
});
after(() => {
  durations.sort((a, b) => a - b);
  console.log(`Solver validation: 500 varied scenarios; ${converged}/500 converged. Toronto timing (200 cases): median ${durations[100]}ms, p95 ${durations[190]}ms, max ${durations.at(-1)}ms.`);
});
