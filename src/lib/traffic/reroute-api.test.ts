import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../../app/api/traffic/reroute/route";
import { placementStreets } from "./server-data";
import { applyRoadSections } from "../road-extent";
import type { RoadDisruption } from "../disruptions";
import type { ReroutingPlan } from "./rerouting";

const request = (items: RoadDisruption[], date = "2026-10-19", minutes = 1065) => new Request("http://localhost/api/traffic/reroute", { method: "POST", body: JSON.stringify({ items, day: "weekday", minutes, date, weather: { rainMmPerHour: 0, snowCmPerHour: 0 } }) });

test("street-description corridors reach the diversion API intact without AI calls", async () => {
  const streets = await placementStreets();
  const extent = streets.resolve("Queen Street West", "Spadina Avenue", "University Avenue");
  const road = streets.roads.get(extent.sections[0].roadId)!;
  const item = applyRoadSections({ id: "queen-corridor-api-test", kind: "closure", title: "Queen closure", position: road.geometry.coordinates[0] as [number, number], roadId: road.properties.id, restriction: "full-closure", startsAt: "2026-10-19T17:30", endsAt: "2026-10-19T19:00", timeZone: "America/Toronto" }, extent.sections, streets.roads);
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let providerCalls = 0;
  try {
    process.env.GEMINI_API_KEY = "test-key";
    globalThis.fetch = async () => { providerCalls++; throw new Error("Closure calculations must not wait for AI."); };
    const response = await POST(request([item]));
    assert.equal(response.status, 200);
    const plan = await response.json() as ReroutingPlan;
    assert.equal(providerCalls, 0);
    assert.equal(plan.source, "local");
    const contribution = plan.perDisruption![item.id];
    assert.ok(contribution);
    for (const section of extent.sections) assert.equal(contribution[section.roadId].capacityScale, 0);
    assert.ok(Object.values(contribution).some(impact => impact.addedHourly > 0));
    for (const impact of Object.values(plan.impacts)) if (impact.addedByDirection) assert.ok(Math.abs(impact.addedByDirection[0] + impact.addedByDirection[1] - impact.addedHourly) < 1e-6);
    const inactive = await POST(request([item], "2026-10-20"));
    assert.equal(inactive.status, 200);
    assert.deepEqual((await inactive.json()).impacts, {});
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  }
});
