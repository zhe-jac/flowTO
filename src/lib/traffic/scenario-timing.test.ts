import assert from "node:assert/strict";
import { test } from "node:test";
import type { Disruption, RoadDisruption } from "../disruptions";
import { disruptionStrength, disruptionWindow, scaleImpact, splitPath, visibleDisruptions, waveDuration, waveLevel } from "./scenario-timing";
import { disruptionFeatures } from "../disruptions";
import { SimulationHistory } from "./simulation-history";

const closure = (startsAt = "", endsAt = ""): RoadDisruption => ({ id: "a", kind: "closure", title: "Closure", position: [-79.38, 43.65], startsAt, endsAt, timeZone: "America/Toronto", roadId: "1", restriction: "full-closure" });

test("unscheduled disruptions start when placed; scheduled ones use their times", () => {
  assert.deepEqual(disruptionWindow(closure(), 780), { start: 780, end: 1440, scheduled: false });
  assert.deepEqual(disruptionWindow(closure("2026-10-17T07:00", "2026-10-17T10:30"), 780), { start: 420, end: 630, scheduled: true });
});

test("road restrictions apply their full diversion immediately and stop at the end", () => {
  const item = closure();
  assert.equal(disruptionStrength(item, 780, 779), 0);
  assert.equal(disruptionStrength(item, 780, 780), 1);
  assert.equal(disruptionStrength(item, 780, 802.5), 1);
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

test("scheduled dates and multi-day overnight intervals use the selected calendar date", () => {
  const item = closure("2026-10-17T22:00", "2026-10-19T02:00");
  assert.equal(disruptionStrength(item, 0, 1380, "2026-10-16"), 0);
  assert.equal(disruptionStrength(item, 0, 1319, "2026-10-17"), 0);
  assert.equal(disruptionStrength(item, 0, 1320, "2026-10-17"), 1);
  assert.equal(disruptionStrength(item, 0, 600, "2026-10-18"), 1);
  assert.equal(disruptionStrength(item, 0, 119, "2026-10-19"), 1);
  assert.equal(disruptionStrength(item, 0, 120, "2026-10-19"), 0);
  assert.equal(disruptionStrength(item, 0, 0, "2026-10-20"), 0);
});

test("unscheduled closures stay on their placement date when scrubbing across days", () => {
  const placed = { date: "2026-10-18", minutes: 600 };
  assert.equal(disruptionStrength(closure(), placed, 900, "2026-10-17"), 0);
  assert.equal(disruptionStrength(closure(), placed, 599, "2026-10-18"), 0);
  assert.equal(disruptionStrength(closure(), placed, 600, "2026-10-18"), 1);
  assert.equal(disruptionStrength(closure(), placed, 1439, "2026-10-18"), 1);
  assert.equal(disruptionStrength(closure(), placed, 600, "2026-10-19"), 0);
});

test("all saved disruption kinds disappear at their end and reappear when rewinding", () => {
  const base = closure("2026-10-18T12:15", "2026-10-18T13:00");
  const items: Disruption[] = [base, { ...base, id: "works", kind: "construction" }, { ...base, id: "crash", kind: "accident" }, { ...base, id: "venue", kind: "event", attendance: 1000 }];
  const placed = new Map();
  const at = (minutes: number) => visibleDisruptions(items, placed, { date: "2026-10-18", minutes });
  assert.deepEqual(at(734), []);
  assert.deepEqual(at(735), items);
  assert.deepEqual(at(779.9), items);
  assert.deepEqual(at(780), []);
  assert.deepEqual(disruptionFeatures(at(780), new Map()).features, []);
  assert.deepEqual(at(750), items);
  assert.equal(items.length, 4);
});

test("visual expiry keeps simulation history available for queue recovery", () => {
  const item = closure("2026-10-18T12:15", "2026-10-18T13:00");
  const history = new SimulationHistory();
  history.update([item], "2026-10-18", 735, 720);
  assert.deepEqual(visibleDisruptions([item], new Map(), { date: "2026-10-18", minutes: 781 }), []);
  const operations = history.update([item], "2026-10-18", 781, 720);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].endsAt, "2026-10-18T13:00");
});

test("visual expiry follows overnight schedules and original unscheduled placement dates", () => {
  const overnight = closure("2026-10-18T23:30", "2026-10-19T01:00");
  const unscheduled = { ...closure(), id: "unscheduled" };
  const items = [overnight, unscheduled];
  const placed = new Map([[unscheduled.id, { date: "2026-10-18", minutes: 750 }]]);
  assert.deepEqual(visibleDisruptions(items, placed, { date: "2026-10-18", minutes: 749 }), []);
  assert.deepEqual(visibleDisruptions(items, placed, { date: "2026-10-18", minutes: 1439 }), items);
  assert.deepEqual(visibleDisruptions(items, placed, { date: "2026-10-19", minutes: 30 }), [overnight]);
  assert.deepEqual(visibleDisruptions(items, placed, { date: "2026-10-19", minutes: 60 }), []);
  assert.deepEqual(visibleDisruptions(items, placed, { date: "2026-10-18", minutes: 800 }), [unscheduled]);
});

test("event arrivals still build independently and preserve their direction split", () => {
  const event: Disruption = { ...closure(), kind: "event", attendance: 1000 };
  assert.equal(disruptionStrength(event, 600, 599), 0);
  assert.equal(disruptionStrength(event, 600, 600), 0.001);
  assert.equal(disruptionStrength(event, 600, 622.5), 0.5);
  const result = scaleImpact({ addedHourly: 400, retained: 1, capacityScale: 1, addedByDirection: [300, 100] }, 0.5);
  assert.deepEqual(result.addedByDirection, [150, 50]);
  assert.equal(result.addedHourly, 200);
});
