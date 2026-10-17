import assert from "node:assert/strict";
import test from "node:test";
import { weatherFromReading } from "../current-weather";
import { DRY_WEATHER, parseWeatherRates, weatherRatesFromIntensity } from "../weather";
import { capacityPerDirection, congestedSpeed, directionState, vehiclesOnRoad } from "./model";
import { CLASS_ASSUMPTIONS, type DayType, type TrafficSegment } from "./types";
import { weatherFactors } from "./weather";

const road = (cls = "Major Arterial", oneway: TrafficSegment["oneway"] = 0): TrafficSegment => ({ id: "road", name: "Test St", cls, oneway, lengthM: 1000, weekdayDaily: 24000, weekendDaily: 12000, coords: [[-79.4, 43.65], [-79.39, 43.65]], source: { kind: "class" } });

test("clear weather preserves the existing capacity, BPR speed and demand", () => {
  for (const cls of Object.keys(CLASS_ASSUMPTIONS)) for (const oneway of [-1, 0, 1] as const) {
    const segment = road(cls, oneway);
    const state = directionState(segment, 1 / 96, "weekday", DRY_WEATHER);
    assert.equal(state.capacity, capacityPerDirection(segment));
    assert.equal(state.flow, oneway === 0 ? 500 : 1000);
    assert.equal(state.speedKmh, congestedSpeed(CLASS_ASSUMPTIONS[cls].freeSpeedKmh, state.ratio));
    assert.deepEqual(state, directionState(segment, 1 / 96));
  }
});

test("increasing either slider monotonically lowers speed and capacity without changing demand", () => {
  for (const cls of [...Object.keys(CLASS_ASSUMPTIONS), "Unknown"]) for (const day of ["weekday", "weekend"] as DayType[]) for (const kind of ["rain", "snow"] as const) {
    let previous = directionState(road(cls), 1 / 96, day);
    for (let intensity = 1; intensity <= 100; intensity++) {
      const weather = weatherRatesFromIntensity({ rain: 0, snow: 0, [kind]: intensity });
      const state = directionState(road(cls), 1 / 96, day, weather);
      assert.equal(state.flow, previous.flow);
      assert.ok(state.speedKmh <= previous.speedKmh);
      assert.ok(state.capacity <= previous.capacity);
      assert.ok(state.ratio >= previous.ratio);
      assert.ok(Number.isFinite(state.speedKmh) && state.speedKmh >= 4);
      previous = state;
    }
    assert.ok(previous.speedKmh < directionState(road(cls), 1 / 96, day).speedKmh);
  }
});

test("expressways and streets have distinct bounded factors and snow has a stronger effect", () => {
  const rain = weatherRatesFromIntensity({ rain: 100, snow: 0 });
  const snow = weatherRatesFromIntensity({ rain: 0, snow: 100 });
  assert.deepEqual(weatherFactors("Expressway", rain), { speed: 0.88, capacity: 0.8 });
  assert.deepEqual(weatherFactors("Major Arterial", rain), { speed: 0.8, capacity: 0.85 });
  assert.deepEqual(weatherFactors("Expressway Ramp", snow), { speed: 0.7, capacity: 0.75 });
  assert.deepEqual(weatherFactors("Local", snow), { speed: 0.65, capacity: 0.8 });
  assert.deepEqual(weatherFactors("Unknown", rain), weatherFactors("Local", rain));
  assert.deepEqual(weatherFactors("Local", { rainMmPerHour: 1000, snowCmPerHour: 1000 }), weatherFactors("Local", snow));
});

test("mixed weather takes the stronger effect for each parameter without stacking penalties", () => {
  for (const cls of ["Expressway", "Major Arterial"]) {
    const mixed = weatherFactors(cls, { rainMmPerHour: 15, snowCmPerHour: 1 });
    const rain = weatherFactors(cls, { rainMmPerHour: 15, snowCmPerHour: 0 });
    const snow = weatherFactors(cls, { rainMmPerHour: 0, snowCmPerHour: 1 });
    assert.equal(mixed.speed, Math.min(rain.speed, snow.speed));
    assert.equal(mixed.capacity, Math.min(rain.capacity, snow.capacity));
  }
});

test("sliders invert the live-weather visual scale consistently for every setting", () => {
  for (let intensity = 0; intensity <= 100; intensity++) {
    const visual = { rain: intensity, snow: 100 - intensity };
    const rates = weatherRatesFromIntensity(visual);
    assert.deepEqual(weatherFromReading({ ...rates, validAt: "2026-10-17T00:00:00Z", fetchedAt: "2026-10-17T00:00:00Z" }), visual);
  }
  assert.deepEqual(weatherRatesFromIntensity({ rain: 100, snow: 100 }), { rainMmPerHour: 15, snowCmPerHour: 5 });
  assert.deepEqual(weatherRatesFromIntensity({ rain: NaN, snow: -10 }), DRY_WEATHER);
});

test("weather increases the time-based vehicle stock estimate without adding trips", () => {
  const segment = road();
  const snow = { rainMmPerHour: 0, snowCmPerHour: 5 };
  assert.ok(vehiclesOnRoad(segment, 1 / 96, "weekday", snow) > vehiclesOnRoad(segment, 1 / 96));
  const empty = { ...segment, weekdayDaily: 0 };
  assert.equal(vehiclesOnRoad(empty, 1 / 96, "weekday", snow), 0);
});

test("API weather validation supports older dry requests and rejects malformed rates", () => {
  assert.deepEqual(parseWeatherRates(undefined), DRY_WEATHER);
  assert.deepEqual(parseWeatherRates({ rainMmPerHour: 2.5, snowCmPerHour: 1 }), { rainMmPerHour: 2.5, snowCmPerHour: 1 });
  for (const value of [null, [], {}, { rainMmPerHour: "2", snowCmPerHour: 0 }, { rainMmPerHour: -1, snowCmPerHour: 0 }, { rainMmPerHour: 0, snowCmPerHour: NaN }, { rainMmPerHour: Infinity, snowCmPerHour: 0 }]) assert.throws(() => parseWeatherRates(value));
});
