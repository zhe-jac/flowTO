import assert from "node:assert/strict";
import test from "node:test";
import { closureFeatures, nearestRoad } from "./closure-placement";
import type { Road } from "./types";

const road = (id: string, coordinates: number[][]): Road => ({
  type: "Feature",
  id,
  geometry: { type: "LineString", coordinates },
  properties: { id, name: id, roadClass: "Local", direction: "Two-way", lengthM: 100, flow: "clear" },
});
const project = ([x, y]: [number, number]) => ({ x, y });

test("snapping selects the closest parallel street rather than the first candidate", () => {
  const farther = road("farther", [[0, 0], [100, 0]]);
  const closer = road("closer", [[0, 15], [100, 15]]);
  const result = nearestRoad([farther, closer], { x: 40, y: 13 }, project);
  assert.equal(result?.road.properties.id, "closer");
  assert.deepEqual(result?.point, { x: 40, y: 15 });
});

test("snapping stops at segment endpoints and rejects drops outside the screen radius", () => {
  const street = road("street", [[0, 0], [100, 0]]);
  assert.deepEqual(nearestRoad([street], { x: 110, y: 0 }, project)?.point, { x: 100, y: 0 });
  assert.equal(nearestRoad([street], { x: 125, y: 0 }, project), null);
  assert.equal(nearestRoad([street], { x: 50, y: 25 }, project), null);
  assert.equal(nearestRoad([], { x: 0, y: 0 }, project), null);
});

test("snapping follows projected bends and ignores nonfinite projected geometry", () => {
  const bend = road("bend", [[0, 0], [10, 0], [10, 10]]);
  const invalid = road("invalid", [[NaN, 0], [NaN, 10]]);
  const result = nearestRoad([invalid, bend], { x: 98, y: 55 }, ([x, y]) => ({ x: x * 10, y: y * 10 }));
  assert.equal(result?.road.properties.id, "bend");
  assert.equal(result?.point.x, 100);
  assert.ok(Math.abs((result?.point.y ?? Infinity) - 55) < 1e-8);
});

test("closure overlays retain the full selected road and its actual endpoints", () => {
  const street = road("street", [[0, 0], [20, 10], [100, 30]]);
  const features = closureFeatures([street]).features;
  assert.equal(features[0], street);
  assert.deepEqual(features.slice(1).map((feature) => feature.geometry), [
    { type: "Point", coordinates: [0, 0] },
    { type: "Point", coordinates: [100, 30] },
  ]);
  assert.equal(features[1].properties?.id, "street");
  assert.equal(closureFeatures([]).features.length, 0);
});
