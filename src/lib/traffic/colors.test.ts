import assert from "node:assert/strict";
import test from "node:test";
import { congestionColor, LEVEL_COLORS, VIVID_COLORS } from "./colors";
import { congestionPosition, directionState, LEVELS } from "./model";
import { weatherRatesFromIntensity } from "../weather";

const colorAt = (ratio: number) => congestionColor(congestionPosition(ratio));

test("continuous congestion colours retain the palette anchors and saturate at both ends", () => {
  LEVELS.forEach((level, index) => {
    assert.equal(congestionPosition(level.minRatio), index);
    assert.deepEqual(colorAt(level.minRatio), LEVEL_COLORS[level.id].road);
    assert.deepEqual(congestionColor(index, true), VIVID_COLORS[level.id]);
  });
  assert.deepEqual(colorAt(-1), LEVEL_COLORS.free.road);
  assert.deepEqual(colorAt(10), LEVEL_COLORS.severe.road);
  assert.deepEqual(colorAt(Infinity), LEVEL_COLORS.severe.road);
  assert.deepEqual(colorAt(NaN), LEVEL_COLORS.free.road);
  assert.deepEqual(congestionColor(-Infinity), LEVEL_COLORS.free.road);
  assert.deepEqual(congestionColor(Infinity), LEVEL_COLORS.severe.road);
  assert.deepEqual(congestionColor(NaN), LEVEL_COLORS.free.road);
});

test("the colour scale is monotonic and does not jump at category thresholds", () => {
  let previous = 0;
  for (let step = 0; step <= 200; step++) {
    const position = congestionPosition(step / 100);
    assert.ok(position >= previous && position <= LEVELS.length - 1);
    previous = position;
    assert.ok(congestionColor(position).every(channel => Number.isInteger(channel) && channel >= 0 && channel <= 255));
  }
  for (const { minRatio } of LEVELS.slice(1)) {
    const before = colorAt(minRatio - 0.000001), after = colorAt(minRatio + 0.000001);
    assert.ok(before.every((channel, i) => Math.abs(channel - after[i]) <= 1));
  }
});

test("weather changes a ribbon colour even when it stays in the same congestion category", () => {
  const segment = { cls: "Major Arterial", oneway: 0 as const, weekdayDaily: 12000, weekendDaily: 6000 };
  const dry = directionState(segment, 1 / 96);
  for (const weather of [{ rain: 50, snow: 0 }, { rain: 100, snow: 0 }, { rain: 0, snow: 100 }]) {
    const state = directionState(segment, 1 / 96, "weekday", weatherRatesFromIntensity(weather));
    assert.equal(state.level, dry.level);
    assert.ok(congestionPosition(state.ratio) > congestionPosition(dry.ratio));
    assert.notDeepEqual(colorAt(state.ratio), colorAt(dry.ratio));
    assert.ok(state.speedKmh < dry.speedKmh);
  }
  assert.deepEqual(colorAt(directionState(segment, 1 / 96, "weekday", weatherRatesFromIntensity({ rain: 0, snow: 0 })).ratio), colorAt(dry.ratio));
});
