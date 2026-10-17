import assert from "node:assert/strict";
import test from "node:test";
import { createDisruption, disruptionFeatures, upsertDisruption, validateDisruption } from "./disruptions";
import type { Coordinate } from "./city-boundary";
import type { EventDisruption } from "./disruptions";
import type { Road } from "./types";

const downtown: Coordinate = [-79.3832, 43.6532];
const road: Road = {
  type: "Feature",
  id: "road-1",
  geometry: { type: "LineString", coordinates: [[-79.384, 43.653], [-79.383, 43.6533]] },
  properties: { id: "road-1", name: "Test Street", roadClass: "Local", direction: "Two-way", lengthM: 90, flow: "clear" },
};

test("events can be placed without a road and never invent attendance or closures", () => {
  const item = createDisruption("event-1", "event", downtown);
  assert.ok(item && item.kind === "event");
  assert.equal(item.attendance, null);
  assert.equal("roadId" in item, false);
  assert.equal("restriction" in item, false);
  assert.equal(validateDisruption(item), null);
  assert.equal(createDisruption("outside", "event", [-79.62, 43.68]), null);
});

test("street disruptions require a matched segment and retain distinct restriction defaults", () => {
  for (const kind of ["closure", "accident", "construction"] as const) {
    assert.equal(createDisruption(kind, kind, downtown), null);
    const item = createDisruption(kind, kind, downtown, road);
    assert.ok(item && item.kind !== "event");
    assert.equal(item.roadId, road.properties.id);
    assert.equal(item.restriction, kind === "closure" ? "full-closure" : "lane-reduction");
    assert.equal(validateDisruption(item), null);
  }
});

test("schedules accept optional Toronto local times and reject incomplete, reversed or impossible dates", () => {
  const item = createDisruption("event", "event", downtown)!;
  assert.equal(item.timeZone, "America/Toronto");
  assert.equal(validateDisruption({ ...item, startsAt: "2026-10-17T18:00", endsAt: "2026-10-17T22:00" }), null);
  for (const [startsAt, endsAt] of [
    ["2026-10-17T18:00", ""],
    ["", "2026-10-17T22:00"],
    ["2026-10-17T22:00", "2026-10-17T18:00"],
    ["2026-10-17T18:00", "2026-10-17T18:00"],
    ["2026-02-30T18:00", "2026-03-01T22:00"],
  ]) assert.ok(validateDisruption({ ...item, startsAt, endsAt }));
});

test("attendance and names are validated without treating an unknown estimate as zero", () => {
  const item = createDisruption("event", "event", downtown) as EventDisruption;
  for (const attendance of [null, 0, 5000]) assert.equal(validateDisruption({ ...item, attendance }), null);
  for (const attendance of [-1, 1.5, NaN, Infinity, 1000001]) assert.ok(validateDisruption({ ...item, attendance }));
  assert.ok(validateDisruption({ ...item, title: "   " }));
  assert.ok(validateDisruption({ ...item, title: "x".repeat(81) }));
});

test("moving and editing a disruption preserves its identity and unrelated scenario items", () => {
  const event = createDisruption("event", "event", downtown)!;
  const accident = createDisruption("accident", "accident", downtown, road)!;
  const original = [event, accident];
  const moved = { ...event, title: "  Evening event  ", position: [-79.39, 43.66] as Coordinate };
  const result = upsertDisruption(original, moved);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].position, moved.position);
  assert.equal(result[0].title, "Evening event");
  assert.equal(result[1], accident);
  assert.deepEqual(original[0].position, downtown);
  const construction = createDisruption("construction", "construction", downtown, road)!;
  assert.equal(upsertDisruption(result, construction).length, 3);
});

test("map features distinguish overlapping road disruptions and keep events as points", () => {
  const event = createDisruption("event", "event", downtown)!;
  const accident = createDisruption("accident", "accident", downtown, road)!;
  const construction = createDisruption("construction", "construction", downtown, road)!;
  const features = disruptionFeatures([event, accident, construction], new Map([[road.properties.id, road]])).features;
  const eventFeatures = features.filter((feature) => feature.properties?.itemId === event.id);
  assert.equal(eventFeatures.length, 1);
  assert.equal(eventFeatures[0].geometry.type, "Point");
  const lines = features.filter((feature) => feature.geometry.type === "LineString");
  assert.equal(lines.length, 2);
  assert.notEqual(lines[0].properties?.itemId, lines[1].properties?.itemId);
  assert.notEqual(lines[0].properties?.color, lines[1].properties?.color);
  assert.equal(lines[0].geometry, road.geometry);
  assert.equal(features.filter((feature) => feature.properties?.role === "endpoint").length, 4);
});
