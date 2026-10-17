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
  assert.match(buildPlan(scenarios).summary, /queued/);
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

test("another disruption can use a lane-reduced street, but never a fully closed one", () => {
  const reduction: Disruption = { ...closure, id: "reduced", roadId: "across", restriction: "lane-reduction" };
  const partial = scenariosFor(data, [closure, reduction], "weekday", 480);
  const detour = partial.find(s => s.item.id === "closure:0")!;
  assert.deepEqual(detour.routes[0].roads, ["north", "across", "south"]);
  const full = scenariosFor(data, [closure, { ...reduction, restriction: "full-closure" }], "weekday", 480);
  assert.equal(full.find(s => s.item.id === "closure:0")!.routes.length, 0);
});
