import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { POST } from "../../app/api/traffic/reroute/route";
import type { TrafficData } from "./types";

test("rerouting API uses only the local solver, caches results, and validates requests", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("External requests are forbidden in solver rerouting"); }) as typeof fetch;
  try {
    const data: TrafficData = JSON.parse(readFileSync("public/data/traffic.json", "utf8"));
    const road = data.segments.find(s => s.id === "10486145")!;
    const body = { items: [{ id: "api-test", kind: "closure", title: "Closure", roadId: road.id, restriction: "full-closure", position: road.coords[0], startsAt: "", endsAt: "", timeZone: "America/Toronto" }], day: "weekday", minutes: 480 };
    const send = (value: unknown) => POST(new Request("http://localhost/api/traffic/reroute", { method: "POST", body: JSON.stringify(value) }));
    const response = await send(body);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.source, "solver");
    assert.equal(result.impacts[road.id].retained, 0);
    assert.equal(result.totalDemandHourly, result.assignedHourly + result.unassignedHourly);
    assert.deepEqual(await (await send(body)).json(), result);
    assert.equal((await send({ ...body, day: "invalid" })).status, 400);
    assert.equal((await send({ ...body, items: Array(21).fill(body.items[0]) })).status, 400);
    assert.equal((await send({ ...body, items: [{ ...body.items[0], roadId: "missing" }] })).status, 400);
    const empty = await (await send({ ...body, items: [] })).json();
    assert.equal(empty.source, "solver");
    assert.deepEqual(empty.impacts, {});
  } finally { globalThis.fetch = original; }
});
