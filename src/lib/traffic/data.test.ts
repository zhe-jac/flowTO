import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RoadCollection } from "../types";
import type { TrafficData } from "./types";
const data = JSON.parse(readFileSync(new URL("../../../public/data/traffic.json", import.meta.url), "utf8")) as TrafficData;
test("every toolbox road has a unique matching citywide traffic segment", () => {
    const roads = JSON.parse(readFileSync(new URL("../../../public/data/downtown-roads.geojson", import.meta.url), "utf8")) as RoadCollection;
    const ids = new Set(data.segments.map((segment) => segment.id));
    assert.equal(ids.size, data.segments.length);
    for (const road of roads.features)
        assert.ok(ids.has(road.properties.id), `Missing traffic segment ${road.properties.id}`);
});
test("bundled traffic profiles and estimates are finite and internally consistent", () => {
    for (const day of ["weekday", "weekend"] as const) {
        assert.equal(data.profiles[day].length, 96);
        assert.ok(data.profiles[day].every((value) => Number.isFinite(value) && value >= 0));
        assert.ok(Math.abs(data.profiles[day].reduce((sum, value) => sum + value, 0) - 1) < 0.0001);
    }
    assert.equal(Object.values(data.meta.sourceCounts).reduce((sum, count) => sum + count, 0), data.segments.length);
    for (const segment of data.segments) {
        assert.ok(Number.isFinite(segment.weekdayDaily) && segment.weekdayDaily >= 0);
        assert.ok(Number.isFinite(segment.weekendDaily) && segment.weekendDaily >= 0);
        assert.ok(Number.isFinite(segment.lengthM) && segment.lengthM > 0);
        assert.ok(segment.coords.length >= 2 && segment.coords.every((point) => point.length === 2 && point.every(Number.isFinite)));
    }
});
