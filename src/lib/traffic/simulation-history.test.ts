import assert from "node:assert/strict";
import { test } from "node:test";
import { SimulationHistory } from "./simulation-history";
import type { RoadDisruption } from "../disruptions";
const item: RoadDisruption = { id: "work", title: "Works", kind: "construction", roadId: "a", restriction: "lane-reduction", position: [-79.38, 43.65], startsAt: "", endsAt: "", timeZone: "America/Toronto" };

test("unscheduled placement keeps its original start while the clock advances", () => {
  const history = new SimulationHistory();
  const first = history.update([item], "2026-10-19", 1020, 1020);
  const later = history.update([item], "2026-10-19", 1080, 1080);
  assert.deepEqual(first, later);
  assert.equal(later[0].startsAt, "2026-10-19T17:00");
});

test("removing a disruption retains its ended operation for queue recovery", () => {
  const history = new SimulationHistory();
  history.update([item], "2026-10-19", 1020, 1020);
  const removed = history.update([], "2026-10-19", 1030, 1020);
  assert.equal(removed.length, 1);
  assert.equal(removed[0].endsAt, "2026-10-19T17:10");
  assert.equal(history.update([], "2026-10-19", 1040, 1020)[0].endsAt, "2026-10-19T17:10");
});

test("moving a disruption keeps the previous extent history without creating repeated revisions", () => {
  const history = new SimulationHistory();
  history.update([item], "2026-10-19", 1020, 1020);
  const moved = { ...item, roadId: "b" };
  const records = history.update([moved], "2026-10-19", 1030, 1020);
  assert.equal(records.length, 2);
  assert.equal(records[0].endsAt, "2026-10-19T17:10");
  assert.equal(records[1].startsAt, "2026-10-19T17:10");
  assert.deepEqual(history.update([moved], "2026-10-19", 1040, 1020), records);
});

test("editing schedule into the past replays that schedule instead of creating an invalid interval", () => {
  const history = new SimulationHistory();
  history.update([{ ...item, startsAt: "2026-10-19T17:00", endsAt: "2026-10-19T19:00" }], "2026-10-19", 1050, 1020);
  const result = history.update([{ ...item, startsAt: "2026-10-19T17:00", endsAt: "2026-10-19T17:20" }], "2026-10-19", 1050, 1020);
  assert.equal(result.length, 1);
  assert.equal(result[0].startsAt, "2026-10-19T17:00");
  assert.equal(result[0].endsAt, "2026-10-19T17:20");
});

test("Reset discards history while removal of a future operation never creates a backlog", () => {
  const history = new SimulationHistory();
  history.update([{ ...item, startsAt: "2026-10-19T19:00", endsAt: "2026-10-19T20:00" }], "2026-10-19", 1020, 1020);
  assert.deepEqual(history.update([], "2026-10-19", 1030, 1020), []);
  history.update([item], "2026-10-19", 1040, 1020);
  history.reset();
  assert.deepEqual(history.update([], "2026-10-19", 1050, 1020), []);
});

test("scenario identity remains unchanged when time windows include different future operations", () => {
  const history = new SimulationHistory();
  const future = { ...item, id: "future", startsAt: "2026-10-19T19:00", endsAt: "2026-10-19T20:00" };
  assert.equal(history.update([item, future], "2026-10-19", 750, 720).length, 1);
  const scenario = history.scenarioKey();
  assert.equal(history.update([item, future], "2026-10-19", 1080, 1080).length, 2);
  assert.equal(history.scenarioKey(), scenario);
  history.update([item, future], "2026-10-19", 750, 720);
  assert.equal(history.scenarioKey(), scenario);
  history.update([{ ...item, roadId: "edited" }, future], "2026-10-19", 750, 720);
  assert.notEqual(history.scenarioKey(), scenario);
});

test("removing or rescheduling a disruption and resetting invalidate the scenario identity", () => {
  const history = new SimulationHistory();
  history.update([item], "2026-10-19", 750, 720);
  const original = history.scenarioKey();
  history.update([{ ...item, startsAt: "2026-10-19T12:30", endsAt: "2026-10-19T13:00" }], "2026-10-19", 750, 720);
  const rescheduled = history.scenarioKey();
  assert.notEqual(rescheduled, original);
  history.update([], "2026-10-19", 770, 720);
  assert.notEqual(history.scenarioKey(), rescheduled);
  history.reset();
  assert.equal(history.scenarioKey(), "[]");
});
