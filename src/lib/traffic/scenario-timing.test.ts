import assert from "node:assert/strict";
import { test } from "node:test";
import type { Disruption } from "../disruptions";
import { disruptionStrength, disruptionWindow, scaleImpact, splitPath, waveDuration, waveLevel } from "./scenario-timing";

const closure = (startsAt = "", endsAt = ""): Disruption => ({ id: "a", kind: "closure", title: "Closure", position: [-79.38, 43.65], startsAt, endsAt, timeZone: "America/Toronto", roadId: "1", restriction: "full-closure" });

test("unscheduled disruptions start when placed; scheduled ones use their times", () => {
  assert.deepEqual(disruptionWindow(closure(), 780), { start: 780, end: 1440, scheduled: false });
  assert.deepEqual(disruptionWindow(closure("2026-10-17T07:00", "2026-10-17T10:30"), 780), { start: 420, end: 630, scheduled: true });
});

test("effects are off before the start, build up, and stop at the end", () => {
  const item = closure();
  assert.equal(disruptionStrength(item, 780, 779), 0);
  assert.ok(disruptionStrength(item, 780, 780) > 0 && disruptionStrength(item, 780, 781) < 0.05);
  assert.ok(Math.abs(disruptionStrength(item, 780, 802.5) - 0.5) < 1e-9);
  assert.equal(disruptionStrength(item, 780, 840), 1);
  const scheduled = closure("2026-10-17T22:00", "2026-10-17T02:00");
  assert.equal(disruptionStrength(scheduled, 0, 23 * 60 + 30), 1);
  assert.equal(disruptionStrength(scheduled, 0, 3 * 60), 0);
});

test("impacts scale between none and the full plan", () => {
  assert.deepEqual(scaleImpact({ addedHourly: 400, retained: 0.5, capacityScale: 0 }, 0.5), { addedHourly: 200, retained: 0.75, capacityScale: 0.5 });
});

test("paths split into short pieces that keep their endpoints", () => {
  const pieces = splitPath([[-79.4, 43.65], [-79.399, 43.65]], 20);
  assert.ok(pieces.length >= 4);
  assert.deepEqual(pieces[0][0], [-79.4, 43.65]);
  assert.deepEqual(pieces.at(-1)!.at(-1), [-79.399, 43.65]);
});

test("the wave turns roads yellow along their length before red", () => {
  const timing = { sweep: 2, gap: 1.5, blend: 0.8 };
  assert.equal(waveLevel(0, 3, 0, 0, timing), 0);
  assert.equal(Math.round(waveLevel(0, 3, 1, 0, timing)), 1);
  assert.equal(waveLevel(0, 3, 1, 1, timing), 0);
  assert.equal(waveLevel(0, 3, waveDuration(3, timing), 1, timing), 3);
  assert.equal(waveLevel(3, 0, waveDuration(3, timing), 0.5, timing), 0);
});
