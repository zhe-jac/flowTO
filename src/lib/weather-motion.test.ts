import assert from "node:assert/strict";
import test from "node:test";
import { lightningDelay, lightningEnvelope, lightningPattern, nextLightningTime, stormStrength, weatherDepth } from "./weather-motion";

test("weather depth preserves flat views and strengthens smoothly with camera pitch", () => {
  assert.equal(weatherDepth(0), 0);
  assert.equal(weatherDepth(8), 0);
  assert.equal(weatherDepth(60), 1);
  let previous = 0;
  for (let pitch = 0; pitch <= 90; pitch++) {
    const value = weatherDepth(pitch);
    assert.ok(value >= previous && value <= 1);
    assert.ok(value - previous < 0.04);
    previous = value;
  }
});

test("lightning is restricted to very heavy rain and strikes stay at least eight seconds apart", () => {
  for (let rain = 0; rain <= 85; rain++) assert.equal(stormStrength(rain), 0);
  assert.ok(stormStrength(90) > 0 && stormStrength(90) < stormStrength(100));
  for (let rain = 86; rain <= 100; rain++) for (const random of [0, 0.5, 1]) {
    const delay = lightningDelay(stormStrength(rain), random);
    assert.ok(delay >= 8000 && delay <= 23000);
  }
  assert.ok(lightningDelay(stormStrength(100), 0.5) < lightningDelay(stormStrength(90), 0.5));
});

test("lightning has a bounded single pulse and fades out without repeated flashes", () => {
  assert.equal(lightningEnvelope(-1), 0);
  assert.equal(lightningEnvelope(0), 0);
  assert.equal(lightningEnvelope(900), 0);
  let previous = 0;
  for (let age = 0; age <= 35; age++) {
    const value = lightningEnvelope(age);
    assert.ok(value >= previous && value <= 1);
    previous = value;
  }
  for (let age = 36; age <= 1000; age++) {
    const value = lightningEnvelope(age);
    assert.ok(value <= previous && value >= 0);
    previous = value;
  }
});

test("some strikes have exactly two separated pulses with a weaker return stroke", () => {
  const single = lightningPattern(0.9, 0.5);
  assert.equal(single.secondAt, null);
  for (const variation of [0, 0.5, 1]) {
    const double = lightningPattern(0.2, variation);
    assert.ok(double.secondAt !== null);
    assert.equal(lightningEnvelope(35, double), 1);
    assert.equal(lightningEnvelope(double.decay + 36, double), 0);
    assert.equal(lightningEnvelope(double.secondAt! + 35, double), double.secondStrength);
    assert.equal(lightningEnvelope(1000, double), 0);
    for (let age = 0; age <= 1000; age++) assert.ok(lightningEnvelope(age, double) >= 0 && lightningEnvelope(age, double) <= 1);
  }
});

test("the first strike arrives promptly and re-entering a storm preserves the strike cooldown", () => {
  for (const random of [0, 0.5, 1]) {
    const first = nextLightningTime(100, -Infinity, 1, random, true);
    assert.ok(first >= 1100 && first <= 1850);
    assert.ok(nextLightningTime(1200, 1100, 1, random, true) >= 9100);
    assert.ok(nextLightningTime(1100, 1100, 1, random) >= 9100);
  }
});
