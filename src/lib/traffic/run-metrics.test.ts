import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeRun } from "./run-metrics";
import type { SimulationResult } from "./simulation-types";

const ledger = (onNetwork: number, delay: number, pending = 0) => ({ generated: 0, completed: 0, onNetwork, pending, balanceError: 0, delayVehicleMinutes: delay });
const pack = (values: number[]) => Buffer.from(new Uint8Array(new Uint16Array(values).buffer)).toString("base64");

test("summarizes extra delay, peak extra vehicles, unfinished trips and worst roads", () => {
  const edge = { from: 0, to: 1, length: 100, speed: 50, capacity: 1000, storage: 30, daily: 1000, lanes: 2 };
  const result = {
    start: 600, end: 660,
    edges: [{ ...edge, id: "a", direction: 1 }, { ...edge, id: "a", direction: -1 }, { ...edge, id: "b", direction: 1 }],
    frames: [
      { minute: 600, values: pack([500, 5000, 0, 10, 500, 5000, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), baseline: ledger(100, 0), scenario: ledger(100, 0), closed: [], capacityScales: {} },
      { minute: 630, values: pack([500, 5000, 0, 10, 400, 2000, 120, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30, 0]), baseline: ledger(100, 60), scenario: ledger(180, 300, 5), closed: [], capacityScales: {} },
      { minute: 660, values: pack([500, 5000, 0, 10, 500, 5000, 0, 10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), baseline: ledger(100, 120), scenario: ledger(130, 720, 10), closed: [], capacityScales: {} },
    ],
    operations: [], warnings: [], version: "test", diagnostics: { trips: 0, elapsedMs: 0, maxStorageError: 0, maxBalanceError: 0 }, context: "observed-count estimates",
  } as unknown as SimulationResult;
  const summary = summarizeRun(result, new Map([["a", "King St W"], ["b", "Queen St W"]]));
  assert.equal(summary.extraDelayHours, 10);
  assert.equal(summary.peakExtraVehicles, 80);
  assert.equal(summary.peakMinute, 630);
  assert.equal(summary.unfinishedTrips, 40);
  assert.equal(summary.series.length, 3);
  assert.deepEqual(summary.topRoads.map(r => r.name), ["King St W", "Queen St W"]);
  assert.equal(summary.topRoads[0].extraQueue, 12);
  assert.equal(summary.topRoads[0].speedDropKmh, 30);
});
