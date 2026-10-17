import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrafficViewport } from "./viewport";
import type { TrafficSegment } from "./types";

const segment = (coords: number[][]) => ({ coords }) as TrafficSegment;

test("viewport selection retains crossing roads even when both endpoints are outside", () => {
  const viewport = createTrafficViewport([
    segment([[-79.5, 43.65], [-79.3, 43.65]]),
    segment([[-79.401, 43.65], [-79.399, 43.65]]),
    segment([[-79.2, 43.8], [-79.1, 43.9]]),
  ]);
  assert.deepEqual(viewport.select([-79.41, 43.64, -79.39, 43.66]), [0, 1]);
});

test("small camera moves reuse the same data array and larger moves update it", () => {
  const viewport = createTrafficViewport([
    segment([[-79.4, 43.65], [-79.399, 43.651]]),
    segment([[-79.2, 43.8], [-79.199, 43.801]]),
  ]);
  const first = viewport.select([-79.41, 43.64, -79.39, 43.66]);
  assert.strictEqual(viewport.select([-79.409, 43.641, -79.389, 43.661]), first);
  assert.deepEqual(viewport.select([-79.21, 43.79, -79.19, 43.81]), [1]);
});

test("zooming into a broad cached view drops offscreen roads and deduplicates cell overlaps", () => {
  const viewport = createTrafficViewport([
    segment([[-79.4, 43.65], [-79.399, 43.651]]),
    segment([[-79.2, 43.8], [-79.199, 43.801]]),
  ]);
  assert.deepEqual(viewport.select([-79.5, 43.6, -79.1, 43.9]), [0, 1]);
  assert.deepEqual(viewport.select([-79.401, 43.649, -79.398, 43.652]), [0]);
  assert.deepEqual(viewport.select([-80, 42, -78, 45]), [0, 1]);
});

test("empty and out-of-area views are safe", () => {
  assert.deepEqual(createTrafficViewport([]).select([-79.4, 43.6, -79.3, 43.7]), []);
  const viewport = createTrafficViewport([segment([[-79.4, 43.65], [-79.39, 43.66]])]);
  assert.deepEqual(viewport.select([-70, 40, -69, 41]), []);
  assert.deepEqual(viewport.select([NaN, 0, 1, 2]), []);
});
