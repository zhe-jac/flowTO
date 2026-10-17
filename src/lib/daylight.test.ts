import assert from "node:assert/strict";
import { test } from "node:test";
import { mixColor, parseColor, simulatorLight, sunTimes } from "./daylight";

const october = new Date("2026-10-17T16:00:00Z");
const june = new Date("2026-06-21T16:00:00Z");
const clock = (minutes: number) => `${Math.floor(minutes / 60)}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

test("Toronto sunrise and sunset match published times within a few minutes", () => {
  const fall = sunTimes(october);
  assert.ok(Math.abs(fall.sunrise - (7 * 60 + 29)) < 6, clock(fall.sunrise));
  assert.ok(Math.abs(fall.sunset - (18 * 60 + 27)) < 6, clock(fall.sunset));
  const summer = sunTimes(june);
  assert.ok(Math.abs(summer.sunrise - (5 * 60 + 36)) < 6, clock(summer.sunrise));
  assert.ok(Math.abs(summer.sunset - (21 * 60 + 3)) < 6, clock(summer.sunset));
});

test("daylight ramps through dawn and dusk instead of switching at one minute", () => {
  const values = Array.from({ length: 180 }, (_, i) => simulatorLight(6 * 60 + 30 + i, october).daylight);
  for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) <= 0.05 + 1e-9);
  assert.equal(simulatorLight(3 * 60, october).phase, "night");
  assert.equal(simulatorLight(12 * 60, october).phase, "day");
  assert.equal(simulatorLight(7 * 60 + 30, october).phase, "dawn");
  assert.equal(simulatorLight(18 * 60 + 30, october).phase, "dusk");
});

test("colours parse and blend", () => {
  assert.deepEqual(parseColor("#fea"), [255, 238, 170, 1]);
  assert.deepEqual(parseColor("rgba(10, 20, 30, 0.5)"), [10, 20, 30, 0.5]);
  assert.equal(mixColor("#000000", "#ffffff", 0.5), "rgba(128, 128, 128, 1)");
  assert.equal(mixColor(["get", "x"], "#fff", 0.5), null);
});
