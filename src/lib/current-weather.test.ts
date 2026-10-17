import assert from "node:assert/strict";
import test from "node:test";
import { isTorontoWeather, parseCurrentWeather, weatherFromReading, WEATHER_REFRESH_MS } from "./current-weather";
import { createTorontoWeatherService } from "./toronto-weather-service";
import { stormStrength } from "./weather-motion";

const now = Date.parse("2026-10-17T16:30:00Z");
const payload = () => ({ current_units: { rain: "mm", showers: "mm", snowfall: "cm", time: "unixtime", interval: "seconds" }, current: { rain: 0.5, showers: 0.25, snowfall: 0.25, interval: 900, time: now / 1000 } });
const reading = parseCurrentWeather(payload(), now);

test("current weather converts interval rain, showers and snowfall into separate hourly rates", () => {
  assert.equal(reading.rainMmPerHour, 3);
  assert.equal(reading.snowCmPerHour, 1);
  assert.equal(reading.validAt, "2026-10-17T16:30:00.000Z");
  assert.equal(reading.fetchedAt, reading.validAt);
  const hourly = payload();
  hourly.current.interval = 3600;
  const result = parseCurrentWeather(hourly, now);
  assert.equal(result.rainMmPerHour, 0.75);
  assert.equal(result.snowCmPerHour, 0.25);
});

test("missing measurements, unexpected units and stale data are rejected rather than treated as clear skies", () => {
  for (const value of [null, {}, { current: {} }, { ...payload(), current: { ...payload().current, rain: null } }, { ...payload(), current: { ...payload().current, snowfall: -1 } }]) assert.throws(() => parseCurrentWeather(value, now));
  const units = payload();
  units.current_units.snowfall = "mm";
  assert.throws(() => parseCurrentWeather(units, now));
  const invalidInterval = payload();
  invalidInterval.current.interval = 0;
  assert.throws(() => parseCurrentWeather(invalidInterval, now));
  assert.throws(() => parseCurrentWeather(payload(), now + 3 * 60 * 60 * 1000));
  assert.throws(() => parseCurrentWeather(payload(), now - 30 * 60 * 1000));
  assert.equal(isTorontoWeather(reading), true);
  assert.equal(isTorontoWeather({ ...reading, rainMmPerHour: NaN }), false);
  assert.equal(isTorontoWeather({ ...reading, validAt: "invalid" }), false);
});

test("visual mapping supports clear skies, mixed precipitation and saturation without changing the lightning threshold", () => {
  assert.deepEqual(weatherFromReading({ ...reading, rainMmPerHour: 0, snowCmPerHour: 0 }), { rain: 0, snow: 0 });
  assert.deepEqual(weatherFromReading(reading), { rain: 48, snow: 50 });
  assert.deepEqual(weatherFromReading({ ...reading, rainMmPerHour: 100, snowCmPerHour: 100 }), { rain: 100, snow: 100 });
  const heavy = weatherFromReading({ ...reading, rainMmPerHour: 15, snowCmPerHour: 0 });
  assert.ok(stormStrength(heavy.rain) > 0);
  assert.equal(stormStrength(85), 0);
  let rain = 0, snow = 0;
  for (let rate = 0; rate <= 20; rate += 0.05) {
    const next = weatherFromReading({ ...reading, rainMmPerHour: rate, snowCmPerHour: rate });
    assert.ok(next.rain >= rain && next.rain <= 100);
    assert.ok(next.snow >= snow && next.snow <= 100);
    rain = next.rain;
    snow = next.snow;
  }
});

test("weather service shares in-flight requests, caches for fifteen minutes and refreshes expired data", async () => {
  let time = now, requests = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = createTorontoWeatherService(async () => {
    requests++;
    await gate;
    return Response.json({ ...payload(), current: { ...payload().current, time: time / 1000 } });
  }, () => time);
  const first = service(), second = service();
  assert.equal(requests, 1);
  release!();
  assert.deepEqual(await first, await second);
  await service();
  assert.equal(requests, 1);
  time += WEATHER_REFRESH_MS + 1;
  await service();
  assert.equal(requests, 2);
});

test("provider failures do not poison the cache and can be retried", async () => {
  let failed = true, requests = 0;
  const service = createTorontoWeatherService(async () => {
    requests++;
    return failed ? new Response(null, { status: 503 }) : Response.json(payload());
  }, () => now);
  await assert.rejects(service());
  failed = false;
  assert.deepEqual(await service(), reading);
  assert.equal(requests, 2);
});
