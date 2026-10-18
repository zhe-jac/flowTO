import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { Road, RoadCollection } from "../types";
import { applyRoadSections, extentAnchors, pointOnRoad, roadDistance, validRoadExtent } from "../road-extent";
import { disruptionFeatures, type RoadDisruption } from "../disruptions";
import { expandRoadDisruptions } from "./disruptions";
import { createStreetExtentResolver, StreetExtentError } from "./street-extent";

const a = [-79.4, 43.65], b = [-79.399, 43.65], c = [-79.398, 43.65];
const road = (id: string, name: string, from: number[], to: number[]): Road => ({ type: "Feature", properties: { id, name, roadClass: "Major Arterial", direction: "one-way", lengthM: 100, flow: "clear" }, geometry: { type: "LineString", coordinates: [from, to] } });
const network = [road("one", "Queen St W", a, b), road("two", "Queen St W", c, b), road("start", "Spadina Ave", a, [-79.4, 43.651]), road("end", "University Ave", c, [-79.398, 43.651])];

test("street descriptions resolve full connected stretches and common abbreviations without IDs", () => {
  const resolver = createStreetExtentResolver(network);
  const extent = resolver.resolve("Queen Street West", "Spadina", "University Avenue");
  assert.deepEqual(extent.sections, [{ roadId: "one", from: 0, to: 1 }, { roadId: "two", from: 1, to: 0 }]);
  assert.equal(extent.roadName, "Queen St W");
  assert.equal(extent.fromStreet, "Spadina Ave");
  assert.equal(extent.toStreet, "University Ave");
  assert.deepEqual(resolver.resolve("Queen", "Spadina Ave.", "University").sections, extent.sections);
  assert.deepEqual(resolver.resolve("Queen St W", "University", "Spadina").sections, [{ roadId: "two", from: 0, to: 1 }, { roadId: "one", from: 1, to: 0 }]);
});

test("missing, unknown and disconnected cross-streets request clarification", () => {
  const resolver = createStreetExtentResolver([...network, road("far", "Bathurst St", [-79.42, 43.65], [-79.42, 43.651])]);
  for (const query of [["Queen", "", "University"], ["Queen", "invented", "University"], ["Queen", "Spadina", "Bathurst"], ["Queen", "Spadina", "Spadina"], ["Queen", "Queen", "University"], ["Queensway", "Spadina", "University"]]) assert.throws(() => resolver.resolve(...query as [string, string, string]), StreetExtentError);
});

test("road stretches never detour onto a different street to reach the end", () => {
  const resolver = createStreetExtentResolver([network[0], { ...network[1], properties: { ...network[1].properties, name: "Richmond St W" } }, network[2], network[3]]);
  assert.throws(() => resolver.resolve("Queen", "Spadina", "University"), StreetExtentError);
});

test("multiple matching paths require clarification instead of an arbitrary shortest path", () => {
  const d = [-79.399, 43.6505];
  const resolver = createStreetExtentResolver([...network, road("branch-one", "Queen St W", a, d), road("branch-two", "Queen St W", d, c)]);
  assert.throws(() => resolver.resolve("Queen", "Spadina", "University"), /More than one stretch/);
});

test("named stretches respect the endpoint editor length and section limits", () => {
  const longEnd = [-79.35, 43.65];
  const long = createStreetExtentResolver([road("long", "Queen St W", a, longEnd), network[2], road("end", "University Ave", longEnd, [-79.35, 43.651])]);
  assert.throws(() => long.resolve("Queen", "Spadina", "University"), /3 km/);
  const pieces = Array.from({ length: 25 }, (_, index) => road(String(index), "Queen St W", [-79.4 + index * 0.0001, 43.65], [-79.4 + (index + 1) * 0.0001, 43.65]));
  const many = createStreetExtentResolver([...pieces, network[2], road("end", "University Ave", [-79.3975, 43.65], [-79.3975, 43.651])]);
  assert.throws(() => many.resolve("Queen", "Spadina", "University"), /24 segments/);
});

test("the bundled Queen Street corridor produces editable geometry and matching traffic restrictions", () => {
  const data = JSON.parse(readFileSync("public/data/downtown-roads.geojson", "utf8")) as RoadCollection;
  const resolver = createStreetExtentResolver(data.features);
  const extent = resolver.resolve("Queen Street West", "Spadina Avenue", "University Avenue");
  assert.ok(extent.sections.length > 1);
  assert.ok(extent.sections.every(section => resolver.roads.get(section.roadId)?.properties.name === "Queen St W"));
  const item: RoadDisruption = applyRoadSections({ id: "queen", title: "Queen closure", kind: "closure", restriction: "full-closure", roadId: extent.sections[0].roadId, position: [-79.39, 43.65], startsAt: "", endsAt: "", timeZone: "America/Toronto" }, extent.sections, resolver.roads);
  assert.ok(validRoadExtent(item, id => resolver.roads.get(id)?.geometry.coordinates));
  const [start, end] = extentAnchors(item);
  for (const [anchor, crossStreet] of [[start, "Spadina Ave"], [end, "University Ave"]] as const) {
    const point = pointOnRoad(resolver.roads.get(anchor.roadId)!, anchor.fraction);
    assert.ok(data.features.some(road => road.properties.name === crossStreet && [road.geometry.coordinates[0], road.geometry.coordinates.at(-1)!].some(endpoint => roadDistance(point, endpoint) <= 2)));
  }
  assert.equal(disruptionFeatures([item], resolver.roads).features.filter(feature => feature.geometry.type === "LineString").length, extent.sections.length);
  assert.equal(expandRoadDisruptions([item]).length, extent.sections.length);
});
