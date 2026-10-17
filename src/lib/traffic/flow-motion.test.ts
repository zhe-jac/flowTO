import assert from "node:assert/strict";
import { test } from "node:test";
import { continuousPulseOffset, PULSE_SPACING } from "./flow-motion";

const cycle = (distance: number) => ((distance % PULSE_SPACING) + PULSE_SPACING) % PULSE_SPACING;

test("changing traffic speed preserves the position of the visible pulse", () => {
  for (const [oldSpeed, newSpeed, time] of [[8, 2, 127.4], [0.25, 12, 839.8], [4, 4, 3601], [12, 0.25, 7200.6]]) {
    const offset = 13.2;
    const next = continuousPulseOffset(offset, oldSpeed, newSpeed, time);
    assert.ok(next >= 0 && next < PULSE_SPACING);
    assert.ok(Math.abs(cycle(time * oldSpeed + offset) - cycle(time * newSpeed + next)) < 1e-8);
  }
});

test("successive speed updates retain phase while time progresses", () => {
  const start = { speed: 9, offset: 3, time: 10 };
  const first = continuousPulseOffset(start.offset, start.speed, 3, start.time);
  const later = 12;
  const second = continuousPulseOffset(first, 3, 6, later);
  assert.ok(Math.abs(cycle(later * 6 + second) - cycle(start.time * start.speed + start.offset + (later - start.time) * 3)) < 1e-8);
});
