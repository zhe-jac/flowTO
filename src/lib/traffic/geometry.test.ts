import assert from "node:assert/strict";
import { test } from "node:test";
import type { FeatureCollection, MultiLineString } from "geojson";
import { prepareTrafficCoordinates, restoreTrafficGeometry } from "./geometry";
import type { TrafficData } from "./types";

test("higher precision avoids metre-rounding kinks without adding vertices", () => {
  const source = [[-79.3996294171833, 43.6364779554631], [-79.3999277894558, 43.6363769154825], [-79.3999344486858, 43.6363746079563], [-79.4002096593692, 43.6362791458221]];
  const bend = (points: number[][]) => {
    const [a, b, c] = points.slice(1);
    const v = [(b[0] - a[0]) * 80500, (b[1] - a[1]) * 111200];
    const w = [(c[0] - b[0]) * 80500, (c[1] - b[1]) * 111200];
    return Math.abs(Math.atan2(v[0] * w[1] - v[1] * w[0], v[0] * w[0] + v[1] * w[1]) * 180 / Math.PI);
  };
  const old = source.map((point) => point.map((value) => Number(value.toFixed(5))));
  const next = prepareTrafficCoordinates(source);
  assert.ok(bend(old) > 60);
  assert.ok(bend(next) < 2);
  assert.equal(next.length, source.length);
  assert.deepEqual(next[0], [-79.3996294, 43.636478]);
});

test("only consecutive duplicate points are removed and loop endpoints are retained", () => {
  const a = [-79.4, 43.65];
  const b = [-79.39, 43.66];
  assert.deepEqual(prepareTrafficCoordinates([a, [...a], [-79.400000001, 43.650000001], b, a]), [a, b, a]);
  assert.throws(() => prepareTrafficCoordinates([[NaN, 43.65]]), /invalid coordinate/);
});

test("geometry refresh preserves traffic values, identifiers and multipart matching", () => {
  const source: FeatureCollection<MultiLineString> = { type: "FeatureCollection", features: [{ type: "Feature", properties: { CENTRELINE_ID: 1 }, geometry: { type: "MultiLineString", coordinates: [[[-79.40012345, 43.65123456], [-79.39, 43.66]], [[-79.38, 43.67], [-79.37, 43.68]]] } }] };
  const original = { meta: { builtAt: "2026-10-17" }, profiles: { weekday: [1], weekend: [2] }, segments: [{ id: "1:1", weekdayDaily: 1234, weekendDaily: 987, coords: [[-79.38, 43.67], [-79.37, 43.68]] }] } as TrafficData;
  const next = restoreTrafficGeometry(original, source);
  assert.deepEqual(next, original);
  assert.notStrictEqual(next.segments[0], original.segments[0]);
  assert.strictEqual(next.meta, original.meta);
  assert.strictEqual(next.profiles, original.profiles);
  assert.throws(() => restoreTrafficGeometry({ ...original, segments: [{ ...original.segments[0], id: "missing" }] }, source), /missing or degenerate/);
});
