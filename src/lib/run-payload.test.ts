import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRunPayload } from "./run-payload";
import { GET, POST } from "../app/api/runs/route";

const valid = () => ({
  name: "  Gardiner closure  ", date: "2026-10-20", weather: { rainMmPerHour: 0, snowCmPerHour: 0 }, disruptions: [], modelVersion: "v1", dataVersion: "2026-10-17",
  summary: { start: 420, end: 600, extraDelayHours: 12.5, peakExtraVehicles: 80, peakMinute: 480, unfinishedTrips: 3, topRoads: [{ id: "1", name: "Lake Shore Blvd W", extraQueue: 40, speedDropKmh: 12 }], series: [{ minute: 420, baselineOnNetwork: 100, scenarioOnNetwork: 120, baselineDelay: 0, scenarioDelay: 5 }] },
});

test("valid runs pass and names are trimmed", () => {
  const checked = validateRunPayload(valid());
  assert.ok("run" in checked);
  assert.equal(checked.run.name, "Gardiner closure");
});

test("bad runs are rejected before reaching the database", () => {
  for (const change of [
    { name: "" }, { date: "next tuesday" }, { weather: { rainMmPerHour: -1, snowCmPerHour: 0 } },
    { disruptions: Array(41).fill({}) }, { summary: { ...valid().summary, series: [] } },
    { summary: { ...valid().summary, end: 100 } }, { summary: { ...valid().summary, topRoads: [{ id: "x", name: "y", extraQueue: Number.NaN, speedDropKmh: 0 }] } },
  ]) assert.ok("error" in validateRunPayload({ ...valid(), ...change }), JSON.stringify(change).slice(0, 60));
});

test("without TIGER_DATABASE_URL the runs API reports it is not configured", async () => {
  delete process.env.TIGER_DATABASE_URL;
  const list = await GET();
  assert.equal(list.status, 503);
  assert.equal((await list.json()).configured, false);
  const saved = await POST(new Request("http://localhost/api/runs", { method: "POST", body: JSON.stringify(valid()) }));
  assert.equal(saved.status, 503);
  const invalid = await POST(new Request("http://localhost/api/runs", { method: "POST", body: "{}" }));
  assert.equal(invalid.status, 400);
});
