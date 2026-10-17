import assert from "node:assert/strict";
import { test } from "node:test";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import sharp from "sharp";
import { simulatorTheme } from "./simulator-theme";
import { initialTrafficClock, advanceClock, CLOCK_RATES } from "./traffic/clock";
import { createMapLighting, createMapLibreLighting } from "./map-lighting";
import { MAP_NIGHT_PALETTE, MAP_PALETTE } from "./map-theme";
import { TORONTO_FADE_IMAGE, TORONTO_NIGHT_FADE_IMAGE } from "./city-boundary-presentation";

test("the simulator uses night from 6 PM through 6 AM and wraps midnight", () => {
  for (const minute of [0, 359.99, 1080, 1439, 1440, -1]) assert.equal(simulatorTheme(minute), "night");
  for (const minute of [360, 720, 1079.99, 1800]) assert.equal(simulatorTheme(minute), "day");
  const clock = { minutes: 1079, day: "weekday" as const, playing: true, rate: CLOCK_RATES[1] };
  assert.equal(simulatorTheme(advanceClock(clock, 2).minutes), "night");
  assert.equal(simulatorTheme(advanceClock({ ...clock, playing: false }, 2).minutes), "day");
});

test("URL demo time and Toronto wall time initialize the same simulator clock", () => {
  const now = new Date("2026-10-17T16:30:00Z");
  const demo = initialTrafficClock("?time=23:15&day=weekday", now);
  assert.equal(demo.minutes, 1395);
  assert.equal(demo.day, "weekday");
  assert.equal(demo.rate.id, "1m");
  assert.equal(simulatorTheme(demo.minutes), "night");
  const current = initialTrafficClock("?time=25:99&day=invalid", now);
  assert.equal(current.minutes, 750);
  assert.equal(current.day, "weekend");
  assert.equal(current.rate.id, "live");
});

test("Mapbox switches lighting only at theme changes and preserves 3D settings", () => {
  let config: Record<string, unknown> = { show3dObjects: true, showPointOfInterestLabels: false };
  const changes: Record<string, unknown>[] = [];
  const images: string[] = [];
  const map = {
    getConfig: () => config,
    setConfig: (_id: string, next: Record<string, unknown>) => { config = next; changes.push(next); },
    getLayer: () => ({}),
    setPaintProperty: () => {},
    getSource: () => ({ type: "image", updateImage: ({ url }: { url: string }) => images.push(url) }),
    getCanvas: () => ({ style: {} }),
  } as unknown as MapboxMap;
  const apply = createMapLighting(map, "mapbox");
  apply("night");
  apply("night");
  assert.equal(changes.length, 1);
  assert.equal(config.lightPreset, "night");
  assert.equal(config.colorLand, MAP_NIGHT_PALETTE.land);
  assert.equal(config.show3dObjects, true);
  assert.equal(config.showPointOfInterestLabels, false);
  apply("day");
  assert.equal(changes.length, 2);
  assert.equal(config.lightPreset, "day");
  assert.equal(config.colorLand, MAP_PALETTE.land);
  assert.equal(config.show3dObjects, true);
  assert.deepEqual(images, [TORONTO_NIGHT_FADE_IMAGE, TORONTO_FADE_IMAGE]);
});

test("MapLibre restores original expressions and leaves traffic and disruption colours intact", () => {
  const expression = ["interpolate", ["linear"], ["zoom"], 10, "#abcdef", 20, "#123456"];
  const paint = new Map<string, unknown>([["road:line-color", expression], ["background:background-color", MAP_PALETTE.land], ["label:text-color", "#234567"]]);
  const original = new Map(paint);
  const touched: string[] = [];
  const map = {
    getStyle: () => ({ layers: [
      { id: "background", type: "background" },
      { id: "road", type: "line", "source-layer": "transportation" },
      { id: "label", type: "symbol", "source-layer": "transportation_name", layout: { "text-field": "name" } },
      { id: "disruption-applied-line", type: "line" },
      { id: "traffic-flow", type: "custom" },
    ] }),
    getPaintProperty: (id: string, property: string) => paint.get(`${id}:${property}`),
    setPaintProperty: (id: string, property: string, value: unknown) => { paint.set(`${id}:${property}`, value); touched.push(id); },
  } as unknown as MapLibreMap;
  const apply = createMapLibreLighting(map);
  apply("night");
  assert.equal(paint.get("background:background-color"), MAP_NIGHT_PALETTE.land);
  assert.equal(paint.get("label:text-color"), MAP_NIGHT_PALETTE.roadLabels);
  assert.ok(!touched.some((id) => /^(traffic|disruption)/.test(id)));
  apply("day");
  for (const [key, value] of original) assert.deepEqual(paint.get(key), value);
  assert.equal(paint.get("label:text-halo-color"), undefined);
});

test("night boundary texture preserves the daytime fade's coverage", async () => {
  const [day, night] = await Promise.all([
    sharp("public/data/toronto-boundary-fade.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp("public/data/toronto-boundary-fade-night.png").ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.equal(day.info.width, night.info.width);
  assert.equal(day.info.height, night.info.height);
  for (let index = 3; index < day.data.length; index += 4) assert.equal(day.data[index], night.data[index]);
});
