import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareSimulation } from "./simulation-network";
import type { TrafficData, TrafficSegment } from "./types";
import type { RoadDisruption } from "../disruptions";
import { validSimulatedStates } from "./rerouting";

const road = (id: string, overrides: Partial<TrafficSegment> = {}): TrafficSegment => ({ id, name: "Queen St", cls: "Major Arterial", oneway: 1, lengthM: 100, weekdayDaily: 10000, weekendDaily: 6000, coords: [[-79.38, 43.65], [-79.379, 43.65]], source: { kind: "class" }, ...overrides });
const data = (segments: TrafficSegment[]) => ({ segments, profiles: { weekday: new Array(96).fill(1 / 96), weekend: new Array(96).fill(1 / 96) } }) as TrafficData;
const closure: RoadDisruption = { id: "closure", kind: "closure", title: "Closure", roadId: "a", position: [-79.38, 43.65], restriction: "full-closure", startsAt: "2026-10-19T17:00", endsAt: "2026-10-19T18:00", timeZone: "America/Toronto" };
const request = (minutes: number) => ({ items: [closure], date: "2026-10-19", minutes, weather: { rainMmPerHour: 0, snowCmPerHour: 0 } });

test("a directional closure selects only the requested directed simulation edges", () => {
  const network = data([road("a", { oneway: 0 })]);
  const both = prepareSimulation(network, request(1060));
  const east = prepareSimulation(network, { ...request(1060), items: [{ ...closure, travelDirection: "eastbound" }] });
  assert.equal(both.operations[0].edges.length, 2);
  assert.deepEqual(east.operations[0].edges.map(i => east.edges[i].direction), [1]);
  assert.throws(() => prepareSimulation(data([road("a")]), { ...request(1060), items: [{ ...closure, travelDirection: "westbound" }] }), /travel direction/);
});

test("persistent junction IDs keep coincident but disconnected roads separate", () => {
  const input = prepareSimulation(data([road("a"), road("b")]), request(1060), { a: ["1", "2"], b: ["3", "4"] });
  assert.notEqual(input.edges[0].from, input.edges[1].from);
  assert.notEqual(input.edges[0].to, input.edges[1].to);
});

test("advancing the output window replays the same onset history", () => {
  const network = data([road("a")]);
  const first = prepareSimulation(network, request(1060));
  const later = prepareSimulation(network, request(1150));
  assert.equal(first.start - first.warmup, later.start - later.warmup);
  assert.ok(later.warmup > first.warmup);
});

test("suspicious historical counts are preserved and flagged rather than inflated", () => {
  const input = prepareSimulation(data([road("a", { weekdayDaily: 24, source: { kind: "intersection", label: "Bay / Queen", date: "2025-07-03" } })]), request(1060));
  assert.equal(input.edges[0].daily, 24);
  assert.ok(input.warnings.some(w => w.includes("very low observed traffic")));
});

test("weather changes speed and capacity without changing input trip demand", () => {
  const network = data([road("a")]);
  const dry = prepareSimulation(network, request(1060));
  const rain = prepareSimulation(network, { ...request(1060), weather: { rainMmPerHour: 15, snowCmPerHour: 0 } });
  assert.equal(dry.edges[0].daily, rain.edges[0].daily);
  assert.ok(rain.edges[0].capacity < dry.edges[0].capacity);
  assert.ok(rain.edges[0].speed < dry.edges[0].speed);
});

test("assistant simulation states reject invalid numerical values", () => {
  assert.equal(validSimulatedStates([{ speedKmh: NaN }, null]), false);
  assert.equal(validSimulatedStates("not states"), false);
  assert.equal(validSimulatedStates([null, null]), true);
});
