import assert from "node:assert/strict";
import { test } from "node:test";
import type { Disruption } from "../disruptions";
import { buildPlan, impactedState, scenariosFor, validateChoices } from "./rerouting";
import type { TrafficData, TrafficSegment } from "./types";

const a = [-79.38, 43.65], b = [-79.37, 43.65], c = [-79.38, 43.66], d = [-79.37, 43.66];
const road = (id: string, coords: number[][], oneway: TrafficSegment["oneway"] = 0): TrafficSegment => ({ id, name: id, coords, oneway, cls: "Local", lengthM: 100, weekdayDaily: 9600, weekendDaily: 9600, source: { kind: "class" } });
const data = { profiles: { weekday: Array(96).fill(1 / 96), weekend: Array(96).fill(1 / 96) }, segments: [road("closed", [a, b]), road("north", [a, c]), road("across", [c, d]), road("south", [d, b])] } as TrafficData;
const closure: Disruption = { id: "closure", title: "Closure", kind: "closure", position: a as [number, number], startsAt: "", endsAt: "", timeZone: "America/Toronto", roadId: "closed", restriction: "full-closure" };

test("closed traffic uses a connected detour and changes downstream congestion", () => {
  const scenarios = scenariosFor(data, [closure], "weekday", 480);
  assert.equal(scenarios.length, 2);
  assert.deepEqual(scenarios[0].routes[0].roads, ["north", "across", "south"]);
  const plan = buildPlan(scenarios);
  assert.equal(plan.impacts.closed.retained, 0);
  assert.equal(plan.impacts.across.addedHourly, 400);
  const baseline = impactedState(data.segments[2], 1 / 96, "weekday");
  const changed = impactedState(data.segments[2], 1 / 96, "weekday", plan.impacts.across);
  assert.equal(changed.flow, baseline.flow + 200);
  assert.ok(changed.speedKmh < baseline.speedKmh);
  assert.deepEqual(buildPlan(scenariosFor(data, [], "weekday", 480)).impacts, {});
});

test("one-way restrictions and disconnected roads cannot be invented by Gemini", () => {
  const directed = { ...data, segments: data.segments.map(s => s.id === "across" ? { ...s, oneway: -1 as const } : s) };
  const scenarios = scenariosFor(directed, [closure], "weekday", 480);
  assert.equal(scenarios[0].routes.length, 0);
  assert.equal(scenarios[1].routes.length, 1);
  assert.ok(buildPlan(scenarios).unroutedHourly! > 0);
  assert.throws(() => validateChoices([{ id: "fake", weights: [1], eventVehicles: 0 }], scenarios));
});

test("Gemini weights split demand without multiplying it and reject malformed plans", () => {
  const scenarios = scenariosFor(data, [closure], "weekday", 480);
  const choices = scenarios.map(s => ({ id: s.item.id, weights: [0.5], eventVehicles: 0 }));
  assert.equal(buildPlan(scenarios, validateChoices(choices, scenarios), "gemini").impacts.across.addedHourly, 400);
  assert.throws(() => validateChoices(choices.map(c => ({ ...c, weights: [-1] })), scenarios));
  assert.throws(() => validateChoices([choices[0], choices[0]], scenarios));
  assert.throws(() => validateChoices(choices.map(c => ({ ...c, weights: [0] })), scenarios));
});

test("lane reductions reduce capacity and events add traffic on approach routes", () => {
  const reduced = buildPlan(scenariosFor(data, [{ ...closure, restriction: "lane-reduction" }], "weekday", 480));
  assert.equal(reduced.impacts.closed.capacityScale, 0.5);
  assert.equal(reduced.impacts.closed.retained, 0.55);
  const event: Disruption = { id: "event", kind: "event", title: "Concert", position: b as [number, number], attendance: 5000, startsAt: "", endsAt: "", timeZone: "America/Toronto" };
  const scenarios = scenariosFor(data, [event], "weekday", 480);
  const plan = buildPlan(scenarios);
  assert.ok(Object.values(plan.impacts).some(i => i.addedHourly > 0));
  const choices = [{ id: "event", weights: scenarios[0].routes.map(() => 1), eventVehicles: 20000 }];
  assert.throws(() => validateChoices(choices, scenarios));
});

test("weather changes legal detour travel times while preserving diverted demand", () => {
  const dry = scenariosFor(data, [closure], "weekday", 480);
  const wet = scenariosFor(data, [closure], "weekday", 480, { rainMmPerHour: 15, snowCmPerHour: 0 });
  dry.forEach((scenario, i) => {
    assert.equal(wet[i].demand, scenario.demand);
    assert.deepEqual(wet[i].routes[0].roads, scenario.routes[0].roads);
    assert.ok(wet[i].routes[0].minutes > scenario.routes[0].minutes);
  });
  const directed = { ...data, segments: data.segments.map(s => s.id === "across" ? { ...s, oneway: -1 as const } : s) };
  assert.equal(scenariosFor(directed, [closure], "weekday", 480, { rainMmPerHour: 0, snowCmPerHour: 5 })[0].routes.length, 0);
});

test("weather and lane reductions combine once and a full closure stays stopped", () => {
  const segment = data.segments[0];
  const weather = { rainMmPerHour: 0, snowCmPerHour: 5 };
  const base = impactedState(segment, 1 / 96, "weekday", undefined, weather);
  const neutral = { retained: 1, addedHourly: 0, capacityScale: 1 };
  assert.deepEqual(impactedState(segment, 1 / 96, "weekday", neutral, weather), base);
  const impact = { retained: 0.55, addedHourly: 100, capacityScale: 0.5 };
  const reduced = impactedState(segment, 1 / 96, "weekday", impact, weather);
  assert.equal(reduced.capacity, base.capacity * 0.5);
  assert.equal(reduced.freeSpeedKmh, base.freeSpeedKmh);
  assert.equal(reduced.flow, base.flow * 0.55 + 50);
  assert.ok(reduced.speedKmh < impactedState(segment, 1 / 96, "weekday", impact).speedKmh);
  const stopped = impactedState(segment, 1 / 96, "weekday", { retained: 0, addedHourly: 0, capacityScale: 0 }, weather);
  assert.equal(stopped.speedKmh, 0);
  assert.equal(stopped.capacity, 0);
  assert.equal(stopped.flow, 0);
});

test("a multi-block closure routes around the corridor and counts through demand once", () => {
  const corridor = { ...data, segments: [road("block1", [a, b], 1), road("block2", [b, d], 1), road("detour1", [a, c], 1), road("detour2", [c, d], 1)] };
  const item: Disruption = { ...closure, roadId: "block1", roadSections: [{ roadId: "block1", from: 0, to: 1 }, { roadId: "block2", from: 0, to: 1 }] };
  const scenarios = scenariosFor(corridor, [item], "weekday", 600);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].demand, 400);
  assert.deepEqual(scenarios[0].routes[0].roads, ["detour1", "detour2"]);
  const plan = buildPlan(scenarios);
  assert.equal(plan.impacts.detour1.addedHourly, 400);
  assert.equal(plan.impacts.detour2.addedHourly, 400);
  assert.equal(plan.impacts.block1.capacityScale, 0);
  assert.equal(plan.impacts.block2.capacityScale, 0);
  assert.equal(plan.unroutedHourly, 0);
  assert.equal(plan.perDisruption![item.id].detour1.addedHourly, 400);
});

test("reversed corridor sections retain their legal one-way travel direction", () => {
  const corridor = { ...data, segments: [road("block1", [b, a], -1), road("block2", [d, b], -1), road("detour1", [a, c], 1), road("detour2", [c, d], 1)] };
  const item: Disruption = { ...closure, roadId: "block1", roadSections: [{ roadId: "block1", from: 1, to: 0 }, { roadId: "block2", from: 1, to: 0 }] };
  const plan = buildPlan(scenariosFor(corridor, [item], "weekday", 600));
  assert.deepEqual(plan.impacts.detour1.addedByDirection, [400, 0]);
  assert.equal(plan.unroutedHourly, 0);
});

test("one-way diversion increases only the direction actually used on a two-way detour", () => {
  const directed = { ...data, segments: data.segments.map(segment => segment.id === "closed" ? { ...segment, oneway: 1 as const } : segment) };
  const plan = buildPlan(scenariosFor(directed, [closure], "weekday", 600));
  assert.deepEqual(plan.impacts.across.addedByDirection, [400, 0]);
  const segment = directed.segments[2];
  const baseline = impactedState(segment, 1 / 96, "weekday");
  const used = impactedState(segment, 1 / 96, "weekday", plan.impacts.across, undefined, undefined, 1);
  const opposite = impactedState(segment, 1 / 96, "weekday", plan.impacts.across, undefined, undefined, -1);
  assert.equal(used.flow, baseline.flow + 400);
  assert.equal(opposite.flow, baseline.flow);
  assert.ok(used.speedKmh < opposite.speedKmh);
  assert.equal((used.flow - baseline.flow) + (opposite.flow - baseline.flow), plan.impacts.across.addedHourly);
});

test("a lane reduction remains available to traffic diverted from another closure", () => {
  const items: Disruption[] = [closure, { ...closure, id: "works", roadId: "across", restriction: "lane-reduction" }];
  const scenarios = scenariosFor(data, items, "weekday", 600);
  assert.ok(scenarios.filter(scenario => scenario.sourceId === closure.id).every(scenario => scenario.routes.some(route => route.roads.includes("across"))));
  const plan = buildPlan(scenarios);
  assert.equal(plan.impacts.across.capacityScale, 0.5);
  assert.ok(plan.impacts.across.addedHourly > 0);
});

test("overlapping restrictions apply the strongest capacity loss without duplicating demand", () => {
  const once = buildPlan(scenariosFor(data, [closure], "weekday", 600));
  const repeated = buildPlan(scenariosFor(data, [closure, { ...closure, id: "duplicate" }, { ...closure, id: "works", restriction: "lane-reduction" }], "weekday", 600));
  assert.equal(repeated.impacts.across.addedHourly, once.impacts.across.addedHourly);
  assert.equal(repeated.impacts.closed.capacityScale, 0);
});

test("a scheduled closure outside the selected date never enters the routing graph", () => {
  const item = { ...closure, startsAt: "2026-10-17T09:00", endsAt: "2026-10-17T11:00" };
  assert.equal(scenariosFor(data, [item], "weekday", 600, undefined, "2026-10-18").length, 0);
  assert.equal(scenariosFor(data, [item], "weekday", 600, undefined, "2026-10-17").length, 2);
});

test("adjacent closures added separately share one corridor diversion without losing or doubling demand", () => {
  const corridor = { ...data, segments: [road("block1", [a, b], 1), road("block2", [b, d], 1), road("detour1", [a, c], 1), road("detour2", [c, d], 1)] };
  const first: Disruption = { ...closure, id: "first", roadId: "block1" };
  const second: Disruption = { ...closure, id: "second", roadId: "block2" };
  const plan = buildPlan(scenariosFor(corridor, [first, second], "weekday", 600));
  assert.equal(plan.unroutedHourly, 0);
  assert.equal(plan.impacts.detour1.addedHourly, 400);
  assert.equal(plan.impacts.detour2.addedHourly, 400);
  assert.equal(plan.perDisruption!.first.detour1.addedHourly, 200);
  assert.equal(plan.perDisruption!.second.detour1.addedHourly, 200);
  assert.equal(plan.perDisruption!.first.block1.capacityScale, 0);
  assert.equal(plan.perDisruption!.first.block2, undefined);
  assert.equal(plan.perDisruption!.second.block2.capacityScale, 0);
});
