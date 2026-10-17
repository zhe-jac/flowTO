import assert from "node:assert/strict";
import { test } from "node:test";
import { advanceClock, CLOCK_RATES, torontoNow } from "./clock";
import { capacityPerDirection, congestedSpeed, directionState, formatClock, levelFor, profileShare, travelDirection } from "./model";
import type { TrafficSegment } from "./types";
const flat = new Array(96).fill(1 / 96);
const road = (overrides: Partial<TrafficSegment> = {}): TrafficSegment => ({
    id: "1",
    name: "Test St",
    cls: "Major Arterial",
    oneway: 0,
    lengthM: 1000,
    weekdayDaily: 24000,
    weekendDaily: 12000,
    source: { kind: "class" },
    coords: [[-79.4, 43.65], [-79.39, 43.65]],
    ...overrides,
});
test("profile share interpolates between bin centres and wraps at midnight", () => {
    const profile = new Array(96).fill(0);
    profile[0] = 1;
    assert.equal(profileShare(profile, 7.5), 1);
    assert.equal(profileShare(profile, 15), 0.5);
    assert.equal(profileShare(profile, 1440), 0.5);
    assert.ok(Math.abs(profileShare(flat, 600) - 1 / 96) < 1e-12);
});
test("two-way roads split volume by direction; one-way roads carry it all", () => {
    const twoWay = directionState(road(), 1 / 96);
    const oneWay = directionState(road({ oneway: 1 }), 1 / 96);
    assert.equal(twoWay.flow, 500);
    assert.equal(oneWay.flow, 1000);
    assert.equal(capacityPerDirection(road({ oneway: 1 })), 1800);
});
test("weekend volumes use the weekend daily total", () => {
    assert.equal(directionState(road(), 1 / 96, "weekend").flow, 250);
});
test("congestion levels and speeds worsen as volume approaches capacity", () => {
    assert.equal(levelFor(0.2), "free");
    assert.equal(levelFor(0.6), "moderate");
    assert.equal(levelFor(0.8), "heavy");
    assert.equal(levelFor(1.2), "severe");
    assert.ok(congestedSpeed(40, 1) < congestedSpeed(40, 0.5));
    assert.equal(Math.round(congestedSpeed(40, 1) * 100) / 100, 34.78);
});
test("clock helpers format time, wrap the day and follow Toronto time when live", () => {
    assert.equal(formatClock(0), "12:00 AM");
    assert.equal(formatClock(17 * 60 + 5), "5:05 PM");
    const state = { minutes: 1439, day: "weekday" as const, playing: true, rate: CLOCK_RATES[1] };
    assert.ok(Math.abs(advanceClock(state, 2).minutes - 1) < 1e-9);
    assert.equal(advanceClock({ ...state, playing: false }, 2).minutes, 1439);
    const noonUtc = new Date("2026-10-17T16:30:00Z");
    assert.deepEqual(torontoNow(noonUtc), { minutes: 12 * 60 + 30, day: "weekend" });
});
test("travel direction names the compass heading", () => {
    assert.equal(travelDirection([-79.4, 43.65], [-79.39, 43.65]), "Eastbound");
    assert.equal(travelDirection([-79.4, 43.66], [-79.4, 43.65]), "Southbound");
});
