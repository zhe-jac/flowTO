import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_SCENARIO, getOpenRoads, parseScenario, toggleClosure } from "./scenario";
import type { RoadCollection } from "./types";

test("restoring shared scenarios discards unknown road IDs and deduplicates closures", () => {
  const result = parseScenario(JSON.stringify({ version: 1, name: "Event plan", closedRoadIds: ["a", "unknown", "a", 42, "b"] }), new Set(["a", "b"]));
  assert.deepEqual(result?.closedRoadIds, ["a", "b"]);
  assert.equal(result?.name, "Event plan");
  assert.equal(parseScenario('{"version":2}', new Set()), null);
  assert.equal(parseScenario("broken JSON", new Set()), null);
});

test("closing and reopening a road preserves other closures and the original scenario", () => {
  const first = toggleClosure(EMPTY_SCENARIO, "a");
  const second = toggleClosure(first, "b");
  assert.deepEqual(toggleClosure(second, "a").closedRoadIds, ["b"]);
  assert.deepEqual(EMPTY_SCENARIO.closedRoadIds, []);
});

test("illustrative traffic excludes closed roads and returns after reopening", () => {
  const roads = { type: "FeatureCollection", features: ["a", "b"].map((id) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { id } })) } as RoadCollection;
  assert.deepEqual(getOpenRoads(roads, ["a"]).features.map((road) => road.properties.id), ["b"]);
  assert.equal(getOpenRoads(roads, []).features.length, 2);
});
