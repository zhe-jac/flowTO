import assert from "node:assert/strict";
import test from "node:test";
import type { MultiPolygon, Polygon } from "geojson";
import { constrainToToronto, createOutsideMask, isPointInBoundary, isPointInToronto, OUTSIDE_TORONTO_MASK, restrictCameraToToronto, TORONTO_BOUNDARY, TORONTO_BOUNDS, type Coordinate } from "./city-boundary";

test("official boundary includes Toronto districts and excludes neighbouring cities even within the bounding rectangle", () => {
  const inside: Coordinate[] = [[-79.3832, 43.6532], [-79.412, 43.7615], [-79.2578, 43.7731], [-79.525, 43.643], [-79.378, 43.62]];
  const outside: Coordinate[] = [[-79.6248, 43.6777], [-79.3, 43.83], [-79.5, 43.85], [-79.65, 43.6], [-79.1, 43.82]];
  for (const point of inside) assert.equal(isPointInToronto(point), true, `Expected ${point} inside Toronto`);
  for (const point of outside) assert.equal(isPointInToronto(point), false, `Expected ${point} outside Toronto`);
  assert.equal(isPointInToronto([NaN, 43.7]), false);
});

test("camera correction keeps outside destinations inside the city without changing valid destinations", () => {
  const start: Coordinate = [-79.3832, 43.6532];
  const inside: Coordinate = [-79.412, 43.7615];
  assert.deepEqual(constrainToToronto(start, inside), inside);
  for (const target of [[-79.6248, 43.6777], [-79.3, 43.83], [0, 0], [NaN, Infinity]] as Coordinate[]) {
    const corrected = constrainToToronto(start, target);
    assert.equal(isPointInToronto(corrected), true);
    assert.notDeepEqual(corrected, target);
  }
});

test("outside mask is the complement of Toronto across a grid spanning the GTA", () => {
  for (let x = -79.7; x <= -79.05; x += 0.025) {
    for (let y = 43.55; y <= 43.9; y += 0.025) {
      const point: Coordinate = [x, y];
      assert.notEqual(isPointInBoundary(point, OUTSIDE_TORONTO_MASK.geometry), isPointInToronto(point), `Mask mismatch at ${point}`);
    }
  }
  for (const point of TORONTO_BOUNDARY.geometry.coordinates.flat(2)) {
    assert.ok(point[0] >= TORONTO_BOUNDS[0][0] && point[0] <= TORONTO_BOUNDS[1][0]);
    assert.ok(point[1] >= TORONTO_BOUNDS[0][1] && point[1] <= TORONTO_BOUNDS[1][1]);
  }
});

test("outside mask preserves separate polygons and covers interior holes", () => {
  const geometry: MultiPolygon = { type: "MultiPolygon", coordinates: [
    [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [1, 2], [2, 2], [2, 1], [1, 1]]],
    [[[6, 0], [8, 0], [8, 2], [6, 2], [6, 0]]],
  ] };
  const mask = createOutsideMask(geometry);
  assert.equal(isPointInBoundary([1.5, 1.5], mask.geometry), true);
  assert.equal(isPointInBoundary([3, 3], mask.geometry), false);
  assert.equal(isPointInBoundary([7, 1], mask.geometry), false);
  assert.equal(isPointInBoundary([5, 1], mask.geometry), true);
  const square: Polygon = { type: "Polygon", coordinates: geometry.coordinates[1] };
  assert.equal(isPointInBoundary([6, 1], square), true);
});

test("camera guard handles synchronous move events and detaches cleanly", () => {
  let center = { lng: -79.3832, lat: 43.6532 };
  let listener: (() => void) | undefined;
  let corrections = 0;
  const detach = restrictCameraToToronto({
    getCenter: () => center,
    on: (_event, handler) => { listener = handler; },
    off: (_event, handler) => { if (listener === handler) listener = undefined; },
    stop: () => {},
    jumpTo: ({ center: point }) => {
      center = { lng: point[0], lat: point[1] };
      corrections++;
      listener?.();
    },
  });
  center = { lng: -79.6248, lat: 43.6777 };
  listener?.();
  assert.equal(corrections, 1);
  assert.equal(isPointInToronto([center.lng, center.lat]), true);
  detach();
  assert.equal(listener, undefined);
});
