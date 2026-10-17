import assert from "node:assert/strict";
import { test } from "node:test";
import type { Disruption } from "../disruptions";
import { closedRoadIds } from "./disruptions";
const base = { title: "Scenario item", position: [-79.38, 43.65] as [
        number,
        number
    ], startsAt: "", endsAt: "", timeZone: "America/Toronto" as const };
test("full road restrictions mask only their matching road and deduplicate overlaps", () => {
    const items: Disruption[] = [
        { ...base, id: "closure", kind: "closure", roadId: "100", restriction: "full-closure" },
        { ...base, id: "construction", kind: "construction", roadId: "100", restriction: "full-closure" },
        { ...base, id: "accident", kind: "accident", roadId: "200", restriction: "lane-reduction" },
        { ...base, id: "event", kind: "event", attendance: 5000 },
    ];
    assert.deepEqual([...closedRoadIds(items)], ["100"]);
    assert.deepEqual([...closedRoadIds(items.filter((item) => item.id !== "closure"))], ["100"]);
    assert.equal(closedRoadIds(items.filter((item) => item.id !== "closure" && item.id !== "construction")).size, 0);
});
test("moving or reopening a restriction restores the original road without mutating scenario items", () => {
    const item: Disruption = { ...base, id: "accident", kind: "accident", roadId: "100", restriction: "full-closure" };
    assert.deepEqual([...closedRoadIds([{ ...item, roadId: "200" }])], ["200"]);
    assert.equal(closedRoadIds([{ ...item, restriction: "lane-reduction" }]).size, 0);
    assert.equal(item.roadId, "100");
    assert.equal(item.restriction, "full-closure");
});
test("stored schedules remain metadata while the scenario has only a typical-day clock", () => {
    const item: Disruption = { ...base, id: "closure", kind: "closure", roadId: "100", restriction: "full-closure", startsAt: "2027-01-01T08:00", endsAt: "2027-01-01T10:00" };
    assert.deepEqual([...closedRoadIds([item])], ["100"]);
});
