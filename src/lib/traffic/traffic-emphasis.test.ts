import assert from "node:assert/strict";
import test from "node:test";
import { levelForSpeed } from "./model";
import { comparisonImpacts } from "./comparison";
import { impactedState, type ReroutingPlan } from "./rerouting";
import { worsenedTraffic } from "./traffic-emphasis";
import type { SimulatedState } from "./simulation-types";
import type { TrafficSegment } from "./types";

const state = (speedKmh: number, queueVehicles = 0): SimulatedState => ({ speedKmh, freeSpeedKmh: 40, queueVehicles, flow: 600, capacity: 900, ratio: 2 / 3, vehicles: 5, delaySeconds: 0, level: levelForSpeed(speedKmh, 40) });

test("existing slow traffic and improved roads do not receive worsening emphasis", () => {
  assert.equal(worsenedTraffic(state(8, 10), state(8, 10)), false);
  assert.equal(worsenedTraffic(state(8, 10), state(20, 5)), false);
  assert.equal(worsenedTraffic(state(35), state(34.5)), false);
});

test("meaningful speed loss and additional queues receive emphasis", () => {
  assert.equal(worsenedTraffic(state(40), state(32)), true);
  assert.equal(worsenedTraffic(state(8), state(6)), true);
  assert.equal(worsenedTraffic(state(35, 3), state(35, 5)), true);
});

test("emphasis has a small release margin and clears when traffic recovers", () => {
  assert.equal(worsenedTraffic(state(40), state(37)), false);
  assert.equal(worsenedTraffic(state(40), state(37), true), true);
  assert.equal(worsenedTraffic(state(35), state(35, 1)), false);
  assert.equal(worsenedTraffic(state(35), state(35, 1), true), true);
  assert.equal(worsenedTraffic(state(40), state(40), true), false);
});

test("directional emphasis compares the matching simulation baseline instead of the old demand curve", () => {
  const before = [state(8, 10), state(35)] as [SimulatedState, SimulatedState];
  const after = [state(8, 10), state(25)] as [SimulatedState, SimulatedState];
  const ledger = { generated: 10, completed: 5, onNetwork: 5, pending: 0, balanceError: 0, delayVehicleMinutes: 0 };
  const plan: ReroutingPlan = { source: "solver", summary: "test", impacts: { road: { retained: 1, capacityScale: 1, addedHourly: 0, statesByDirection: after } }, simulation: { baseline: { road: { retained: 1, capacityScale: 1, addedHourly: 0, statesByDirection: before } }, closed: [], baselineLedger: ledger, ledger, warnings: [], minute: 735, version: "test" } };
  const road: TrafficSegment = { id: "road", name: "King St W", coords: [[-79.39, 43.65], [-79.38, 43.65]], oneway: 0, cls: "Major Arterial", lengthM: 100, weekdayDaily: 1000, weekendDaily: 1000, source: { kind: "class" } };
  const baseline = comparisonImpacts(plan, [], new Map(), 735, "before");
  const scenario = comparisonImpacts(plan, [], new Map(), 735, "after");
  const result = [1, -1].map(direction => worsenedTraffic(impactedState(road, 1 / 96, "weekend", baseline.impacts.road, undefined, undefined, direction as 1 | -1), impactedState(road, 1 / 96, "weekend", scenario.impacts.road, undefined, undefined, direction as 1 | -1)));
  assert.deepEqual(result, [false, true]);
});
