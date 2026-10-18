import assert from "node:assert/strict";
import { test } from "node:test";
import { SimulationCache } from "./simulation-cache";
import { simulateNetwork } from "./simulation-engine.mjs";
import { sampleSimulation } from "./simulation-plan";
import type { SimulationResult } from "./simulation-types";

function result(start: number, end: number): SimulationResult {
  const ledger = { generated: 0, completed: 0, onNetwork: 0, pending: 0, balanceError: 0, delayVehicleMinutes: 0 };
  return { version: "test", start, end, edges: [], operations: [], frames: [start, end].map(minute => ({ minute, values: "", baseline: ledger, scenario: ledger, closed: [], capacityScales: {} })), warnings: [], context: "observed-count estimates", diagnostics: { trips: 0, elapsedMs: 0, maxStorageError: 0, maxBalanceError: 0 } };
}

test("moving forward and rewinding keeps every completed window of the current scenario", () => {
  const cache = new SimulationCache();
  cache.useScenario("unchanged");
  const first = result(690, 840), later = result(810, 960);
  cache.store("unchanged", "first", "2026-10-18", first);
  cache.store("unchanged", "later", "2026-10-18", later);
  assert.equal(cache.find("2026-10-18", 915)?.data, later);
  assert.equal(cache.find("2026-10-18", 735)?.data, first);
  cache.useScenario("unchanged");
  assert.equal(cache.find("2026-10-18", 735)?.data, first);
  assert.equal(cache.find("2026-10-18", 915)?.data, later);
});

test("overlapping calculations never replace an already simulated time with a different run", () => {
  const cache = new SimulationCache();
  cache.useScenario("unchanged");
  const first = result(690, 840), later = result(810, 960);
  cache.store("unchanged", "first", "2026-10-18", first);
  assert.equal(cache.find("2026-10-18", 825)?.data, first);
  cache.store("unchanged", "later", "2026-10-18", later);
  assert.equal(cache.find("2026-10-18", 825)?.data, first);
  assert.equal(cache.find("2026-10-18", 840)?.data, first);
  assert.equal(cache.find("2026-10-18", 840.5)?.data, later);
});

test("scenario changes discard old results and reject late responses from earlier scenarios", () => {
  const cache = new SimulationCache();
  cache.useScenario("old closures");
  cache.store("old closures", "old", "2026-10-18", result(690, 840));
  cache.useScenario("edited closure or weather");
  assert.equal(cache.find("2026-10-18", 735), null);
  assert.equal(cache.store("old closures", "late", "2026-10-18", result(690, 840)), false);
  assert.equal(cache.find("2026-10-18", 735), null);
});

test("completed windows remain locally available beyond the server's six-result cache", () => {
  const cache = new SimulationCache();
  cache.useScenario("unchanged");
  for (let hour = 0; hour < 24; hour += 2) cache.store("unchanged", String(hour), "2026-10-18", result(hour * 60, (hour + 2) * 60));
  assert.ok(cache.find("2026-10-18", 1410));
  assert.equal(cache.find("2026-10-18", 30)?.key, "0");
});

test("cached coverage follows calendar dates and reuses calculated frames across midnight", () => {
  const cache = new SimulationCache();
  cache.useScenario("unchanged");
  cache.store("unchanged", "midnight", "2026-10-19", result(-30, 120));
  assert.equal(cache.find("2026-10-18", 1425)?.minute, -15);
  assert.equal(cache.find("2026-10-19", 15)?.minute, 15);
  assert.equal(cache.find("2026-10-20", 15), null);
  assert.equal(cache.find("2026-10-18", 1400), null);
  assert.equal(cache.find("2026-10-19", 121), null);
});

test("results never claim coverage beyond their actual available frames", () => {
  const cache = new SimulationCache();
  cache.useScenario("unchanged");
  const truncated = result(690, 840);
  truncated.frames[0].minute = 700;
  truncated.frames[1].minute = 830;
  cache.store("unchanged", "truncated", "2026-10-18", truncated);
  assert.equal(cache.find("2026-10-18", 695), null);
  assert.equal(cache.find("2026-10-18", 835), null);
  assert.ok(cache.find("2026-10-18", 735));
  assert.equal(cache.store("unchanged", "empty", "2026-10-18", { ...truncated, frames: [] }), false);
});

test("rewinding retrieves exactly the same simulated speeds and queues after calculating a later window", () => {
  const cache = new SimulationCache();
  cache.useScenario("construction");
  const edge = { id: "road", direction: 1 as const, from: 0, to: 1, length: 120, speed: 40, capacity: 900, storage: 12, daily: 14400, lanes: 1 };
  const input = { edges: [edge], nodeCount: 2, profile: new Array(96).fill(1 / 96), start: 0, end: 30, warmup: 10, step: 5, interval: 1, operations: [{ id: "works", kind: "construction" as const, edges: [0], start: 5, end: 20, capacity: 0.5, vehicles: 0 }], warnings: [] };
  const first = simulateNetwork(input);
  cache.store("construction", "first", "2026-10-18", first);
  const original = sampleSimulation(first, 15);
  cache.store("construction", "later", "2026-10-18", simulateNetwork({ ...input, start: 20, end: 60 }));
  assert.ok(cache.find("2026-10-18", 45));
  const rewound = cache.find("2026-10-18", 15)!;
  assert.deepEqual(sampleSimulation(rewound.data, rewound.minute), original);
});
