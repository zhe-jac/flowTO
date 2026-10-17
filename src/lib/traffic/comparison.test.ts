import assert from "node:assert/strict";
import { test } from "node:test";
import type { Disruption } from "../disruptions";
import type { ReroutingPlan } from "./rerouting";
import { comparisonImpacts } from "./comparison";

const event = (id: string): Disruption => ({ id, kind: "event", title: id, attendance: 1000, position: [-79.38, 43.65], startsAt: "", endsAt: "", timeZone: "America/Toronto" });
const items = [event("old"), event("new")];
const placed = new Map([["old", 480], ["new", 600]]);
const plan: ReroutingPlan = { source: "solver", summary: "test", impacts: { road: { retained: 1, capacityScale: 1, addedHourly: 300 } }, perDisruption: { old: { road: { retained: 1, capacityScale: 1, addedHourly: 100 } }, new: { road: { retained: 1, capacityScale: 1, addedHourly: 200 } } } };

test("Before always uses baseline, even with a mature plan", () => {
  const result = comparisonImpacts(plan, items, placed, 700, "before");
  assert.deepEqual(result.impacts, {});
  assert.equal(result.closed.size, 0);
});
test("UI supports the existing aggregate-only rerouter without a solver dependency", () => {
  const aggregate = { source: "gemini" as const, summary: "legacy", impacts: plan.impacts };
  assert.equal(comparisonImpacts(aggregate, [items[0]], placed, 600, "after").impacts.road.addedHourly, 300);
  assert.deepEqual(comparisonImpacts(aggregate, items, placed, 600, "before").impacts, {});
});
test("a mature event cannot accelerate another event's buildup", () => {
  assert.equal(comparisonImpacts(plan, items, placed, 600, "after").impacts.road.addedHourly, 100.2);
  assert.equal(comparisonImpacts(plan, items, placed, 622.5, "after").impacts.road.addedHourly, 200);
  assert.equal(comparisonImpacts(plan, items, placed, 650, "after").impacts.road.addedHourly, 300);
});
test("scheduled future/ended disruptions and Reset do not affect the display", () => {
  const future = { ...items[1], startsAt: "2026-10-17T12:00", endsAt: "2026-10-17T13:00" };
  assert.equal(comparisonImpacts(plan, [items[0], future], placed, 600, "after").impacts.road.addedHourly, 100);
  assert.equal(comparisonImpacts(plan, [future], placed, 800, "after").impacts.road, undefined);
  assert.deepEqual(comparisonImpacts(plan, [], placed, 650, "after").impacts, {});
});
test("closed-road display and details agree immediately, Before restores them", () => {
  const closure: Disruption = { ...event("closed"), kind: "closure", roadId: "road", restriction: "full-closure" };
  const result = comparisonImpacts(null, [closure], new Map([["closed", 600]]), 600, "after");
  assert.ok(result.closed.has("road"));
  assert.deepEqual(result.impacts.road, { addedHourly: 0, capacityScale: 0, retained: 0 });
  assert.equal(comparisonImpacts(null, [closure], placed, 600, "before").closed.size, 0);
});
