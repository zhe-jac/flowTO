import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { nearestRoad } from "./closure-placement";
import { createDisruption, disruptionFeatures, upsertDisruption, validateDisruption } from "./disruptions";
import type { RoadDisruption } from "./disruptions";
import type { Road, RoadCollection } from "./types";
import { affectedRoadIds, applyRoadSections, extentAnchors, extentDetails, pointOnRoad, roadDistance, sectionCoordinates, traceRoadExtent, validRoadExtent } from "./road-extent";
import { closedRoadIds, expandRoadDisruptions } from "./traffic/disruptions";
import { comparisonImpacts } from "./traffic/comparison";

const road = (id: string, points: number[][]): Road => ({ type: "Feature", geometry: { type: "LineString", coordinates: points }, properties: { id, name: id, lengthM: 100, roadClass: "Local", direction: "Two-way", flow: "clear" } });
const a = road("a", [[-79.384, 43.65], [-79.383, 43.65]]);
const b = road("b", [[-79.382, 43.65], [-79.383, 43.65]]);
const c = road("c", [[-79.382, 43.65], [-79.382, 43.651]]);
const disconnected = road("parallel", [[-79.384, 43.6502], [-79.382, 43.6502]]);
const roads = new Map([a, b, c, disconnected].map(item => [item.properties.id, item]));
const tracedSections = (from = 0.5, to = 0.5) => {
  const first = traceRoadExtent([{ roadId: "a", from, to: 1 }], { roadId: "b", fraction: 0 }, 1, roads)!;
  return traceRoadExtent(first, { roadId: "c", fraction: to }, 1, roads)!;
};
const item = createDisruption("closure", "closure", [-79.3835, 43.65], a) as RoadDisruption;

test("snapped positions retain a distance fraction along the actual road", () => {
  const bend = road("bend", [[-79.384, 43.65], [-79.383, 43.65], [-79.383, 43.651]]);
  const snap = nearestRoad([bend], { x: 100, y: 50 }, ([x, y]) => ({ x: (x + 79.384) * 100000, y: (y - 43.65) * 100000 }));
  assert.ok(snap);
  assert.ok(roadDistance(snap.coordinate, [-79.383, 43.6505]) < 0.01);
  assert.ok(roadDistance(pointOnRoad(bend, snap.fraction), snap.coordinate) < 0.01);
});

test("partial and reversed extents retain the road bend instead of cutting across it", () => {
  const bend = road("bend", [[-79.384, 43.65], [-79.383, 43.65], [-79.383, 43.651]]);
  const points = sectionCoordinates(bend, 0.25, 0.75);
  assert.equal(points.length, 3);
  assert.deepEqual(points[1], bend.geometry.coordinates[1]);
  assert.deepEqual(sectionCoordinates(bend, 0.75, 0.25), [...points].reverse());
  assert.ok(roadDistance(points[0], bend.geometry.coordinates[0]) > 5);
  assert.ok(roadDistance(points.at(-1)!, bend.geometry.coordinates.at(-1)!) > 5);
});

test("endpoints extend through connected blocks with reversed source geometry and can shrink again", () => {
  const sections = tracedSections();
  assert.deepEqual(sections, [{ roadId: "a", from: 0.5, to: 1 }, { roadId: "b", from: 1, to: 0 }, { roadId: "c", from: 0, to: 0.5 }]);
  const updated = applyRoadSections(item, sections!, roads);
  assert.deepEqual(extentAnchors(updated), [{ roadId: "a", fraction: 0.5 }, { roadId: "c", fraction: 0.5 }]);
  assert.ok(validRoadExtent(updated, id => roads.get(id)?.geometry.coordinates));
  assert.deepEqual(traceRoadExtent(sections!, { roadId: "a", fraction: 0.8 }, 1, roads), [{ roadId: "a", from: 0.5, to: 0.8 }]);
});

test("nearby disconnected streets cannot form an extent and handles cannot collapse", () => {
  assert.equal(traceRoadExtent([{ roadId: "a", from: 0.5, to: 1 }], { roadId: "parallel", fraction: 0.5 }, 1, roads), null);
  assert.equal(traceRoadExtent([{ roadId: "a", from: 0.5, to: 1 }], { roadId: "a", fraction: 0.51 }, 1, roads), null);
  assert.equal(traceRoadExtent([{ roadId: "missing", from: 0, to: 1 }], { roadId: "a", fraction: 1 }, 1, roads), null);
  const sections = [{ roadId: "a", from: 0, to: 1 }, { roadId: "parallel", from: 0, to: 1 }];
  assert.equal(validRoadExtent({ ...item, roadSections: sections }, id => roads.get(id)?.geometry.coordinates), false);
});

test("tracing preserves the cursor's longer route even when a shortcut exists", () => {
  const down = road("down", [[-79.383, 43.65], [-79.383, 43.649]]);
  const around = road("around", [[-79.383, 43.649], [-79.382, 43.65]]);
  const choices = new Map([...roads, ["down", down] as const, ["around", around] as const]);
  let path = [{ roadId: "a", from: 0.5, to: 1 }];
  for (const target of [{ roadId: "down", fraction: 0.5 }, { roadId: "around", fraction: 0.5 }, { roadId: "c", fraction: 0.5 }]) {
    path = traceRoadExtent(path, target, 1, choices)!;
    assert.ok(path);
  }
  assert.deepEqual(path.map(section => section.roadId), ["a", "down", "around", "c"]);
  assert.ok(validRoadExtent(applyRoadSections(item, path, choices), id => choices.get(id)?.geometry.coordinates));
});

test("an unvisited intermediate road is never inserted to connect a distant cursor position", () => {
  assert.equal(traceRoadExtent([{ roadId: "a", from: 0.5, to: 1 }], { roadId: "c", fraction: 0.5 }, 1, roads), null);
  const first = traceRoadExtent([{ roadId: "a", from: 0.5, to: 1 }], { roadId: "b", fraction: 0.5 }, 1, roads)!;
  assert.deepEqual(traceRoadExtent(first, { roadId: "c", fraction: 0.5 }, 1, roads), tracedSections());
});

test("dragging the start preserves the other end and retracing removes only the drawn tail", () => {
  const left = road("left", [[-79.385, 43.65], [-79.384, 43.65]]);
  const choices = new Map([...roads, ["left", left] as const]);
  const original = tracedSections();
  const extended = traceRoadExtent(original, { roadId: "left", fraction: 0.5 }, 0, choices)!;
  assert.deepEqual(extended.map(section => section.roadId), ["left", "a", "b", "c"]);
  assert.deepEqual(extended[0], { roadId: "left", from: 0.5, to: 1 });
  assert.deepEqual(extended.at(-1), original.at(-1));
  assert.deepEqual(traceRoadExtent(extended, { roadId: "b", fraction: 0.5 }, 0, choices), [{ roadId: "b", from: 0.5, to: 0 }, { roadId: "c", from: 0, to: 0.5 }]);
  assert.deepEqual(original, tracedSections());
});

test("snapping onto another outgoing street replaces only the tail after the latest intersection", () => {
  const branch = road("branch", [[-79.382, 43.65], [-79.381, 43.649]]);
  const choices = new Map([...roads, ["branch", branch] as const]);
  const original = tracedSections();
  const switched = traceRoadExtent(original, { roadId: "branch", fraction: 0.7 }, 1, choices)!;
  assert.deepEqual(switched, [...original.slice(0, 2), { roadId: "branch", from: 0, to: 0.7 }]);
  assert.deepEqual(original, tracedSections());
  assert.ok(validRoadExtent(applyRoadSections(item, switched, choices), id => choices.get(id)?.geometry.coordinates));
});

test("passing the next intersection locks the completed block instead of rerouting it", () => {
  const branch = road("branch", [[-79.383, 43.65], [-79.383, 43.651]]);
  const choices = new Map([...roads, ["branch", branch] as const]);
  const before = [{ roadId: "a", from: 0.5, to: 1 }, { roadId: "b", from: 1, to: 0.5 }];
  assert.deepEqual(traceRoadExtent(before, { roadId: "branch", fraction: 0.8 }, 1, choices), [{ roadId: "a", from: 0.5, to: 1 }, { roadId: "branch", from: 0, to: 0.8 }]);
  const passed = [...before.slice(0, 1), { roadId: "b", from: 1, to: 0 }];
  assert.equal(traceRoadExtent(passed, { roadId: "branch", fraction: 0.8 }, 1, choices), null);
  assert.deepEqual(traceRoadExtent(passed, { roadId: "c", fraction: 0.6 }, 1, choices), [...passed, { roadId: "c", from: 0, to: 0.6 }]);
});

test("start-handle snapping switches the outgoing street while keeping the opposite blocks fixed", () => {
  const branch = road("branch", [[-79.383, 43.65], [-79.383, 43.651]]);
  const choices = new Map([...roads, ["branch", branch] as const]);
  const original = tracedSections();
  const switched = traceRoadExtent(original, { roadId: "branch", fraction: 0.7 }, 0, choices)!;
  assert.deepEqual(switched, [{ roadId: "branch", from: 0.7, to: 0 }, ...original.slice(1)]);
  assert.ok(validRoadExtent(applyRoadSections(item, switched, choices), id => choices.get(id)?.geometry.coordinates));
});

test("traced extents reject invalid coordinates and excessively long selections", () => {
  const long = road("long", [[-79.383, 43.65], [-79.30, 43.65]]);
  const choices = new Map([...roads, ["long", long] as const]);
  assert.equal(traceRoadExtent([{ roadId: "a", from: 0, to: 1 }], { roadId: "long", fraction: 1 }, 1, choices), null);
  assert.equal(traceRoadExtent([{ roadId: "long", from: 0, to: 0.1 }], { roadId: "long", fraction: 1 }, 1, choices), null);
  assert.equal(traceRoadExtent(tracedSections(), { roadId: "a", fraction: NaN }, 0, choices), null);
  assert.equal(traceRoadExtent(tracedSections(), { roadId: "a", fraction: 2 }, 0, choices), null);
});

test("saved extents keep identity and metadata while previews leave the original unchanged", () => {
  const original = { ...item, title: "Work zone", startsAt: "2026-10-17T09:00", endsAt: "2026-10-17T17:00" };
  const changed = applyRoadSections(original, tracedSections(0.25, 0.75)!, roads);
  assert.equal(changed.id, original.id);
  assert.equal(changed.title, original.title);
  assert.equal(changed.startsAt, original.startsAt);
  assert.equal(original.roadSections, undefined);
  assert.equal(upsertDisruption([original], changed).length, 1);
  assert.equal(validateDisruption(changed), null);
  const middle = roads.get(changed.roadId)!;
  assert.ok(nearestRoad([middle], { x: changed.position[0], y: changed.position[1] }, ([x, y]) => ({ x, y }), 1e-8));
});

test("all three street tools draw only their selected geometry and two outer endpoints", () => {
  const sections = tracedSections(0.25, 0.75)!;
  for (const kind of ["closure", "construction", "accident"] as const) {
    const changed = applyRoadSections({ ...item, kind }, sections, roads);
    const features = disruptionFeatures([changed], roads).features;
    const lines = features.filter(feature => feature.geometry.type === "LineString");
    const ends = features.filter(feature => feature.properties?.role === "endpoint");
    assert.equal(lines.length, 3);
    assert.equal(ends.length, 2);
    assert.deepEqual(ends.map(feature => feature.geometry.coordinates), [pointOnRoad(a, 0.25), pointOnRoad(c, 0.75)]);
    assert.deepEqual(lines[0].geometry.coordinates, sectionCoordinates(a, 0.25, 1));
    assert.ok(extentDetails(changed, roads).lengthM > 100);
  }
});

test("affected road IDs, Before/After and existing traffic processing include every selected segment", () => {
  const changed = applyRoadSections(item, tracedSections(0.25, 0.75)!, roads);
  assert.deepEqual(affectedRoadIds(changed), ["a", "b", "c"]);
  assert.deepEqual([...closedRoadIds([changed])], ["a", "b", "c"]);
  const expanded = expandRoadDisruptions([changed]);
  assert.deepEqual(expanded.map(item => item.kind !== "event" && item.roadId), ["a", "b", "c"]);
  assert.equal(new Set(expanded.map(item => item.id)).size, 3);
  const placed = new Map([[item.id, 600]]);
  assert.deepEqual([...comparisonImpacts(null, [changed], placed, 600, "after").closed], ["a", "b", "c"]);
  assert.equal(comparisonImpacts(null, [changed], placed, 600, "before").closed.size, 0);
});

test("malformed, repeated and empty selections cannot be saved", () => {
  for (const sections of [[], [{ roadId: "a", from: NaN, to: 1 }], [{ roadId: "a", from: -0.1, to: 1 }], [{ roadId: "a", from: 0.5, to: 0.5 }], [{ roadId: "a", from: 0, to: 1 }, { roadId: "a", from: 1, to: 0 }], [{ roadId: "b", from: 0, to: 1 }]]) {
    assert.ok(validateDisruption({ ...item, roadSections: sections }));
  }
});

test("bundled downtown extents agree with citywide traffic geometry", async () => {
  const collection = JSON.parse(await readFile("public/data/downtown-roads.geojson", "utf8")) as RoadCollection;
  const traffic = JSON.parse(await readFile("public/data/traffic.json", "utf8")) as { segments: { id: string; coords: number[][] }[] };
  const coords = new Map(traffic.segments.map(segment => [segment.id, segment.coords]));
  for (const road of collection.features.filter((_, index) => index % 100 === 0)) {
    const single = createDisruption("sample", "construction", pointOnRoad(road, 0.5), road) as RoadDisruption;
    const extent = applyRoadSections(single, [{ roadId: road.properties.id, from: 0.2, to: 0.8 }], new Map([[road.properties.id, road]]));
    if (extentDetails(extent, new Map([[road.properties.id, road]])).lengthM < 5) continue;
    assert.ok(validRoadExtent(extent, id => coords.get(id)), road.properties.id);
  }
});
