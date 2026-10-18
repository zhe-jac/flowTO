import assert from "node:assert/strict";
import { test } from "node:test";
import { requestSimulation } from "./simulation-client";
import type { SimulationResult } from "./simulation-types";

const result: SimulationResult = { version: "test", start: 0, end: 1, edges: [], operations: [], frames: [], warnings: [], diagnostics: { trips: 0, elapsedMs: 1, maxStorageError: 0, maxBalanceError: 0 }, context: "observed-count estimates" };
const complete = () => Response.json({ id: "current", status: "complete", result });

test("temporary capacity limits retry the same submission and then poll queued work", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const responses = [Response.json({ error: "busy" }, { status: 429, headers: { "Retry-After": "0" } }), Response.json({ id: "current", status: "queued" }, { status: 202 }), complete()];
  const send: typeof fetch = async (url, options) => { calls.push({ url: String(url), options }); return responses.shift()!; };
  assert.deepEqual(await requestSimulation("scenario", new AbortController().signal, send), result);
  assert.deepEqual(calls.map(call => call.url), ["/api/traffic/simulations", "/api/traffic/simulations", "/api/traffic/simulations/current"]);
  assert.equal(calls[0].options?.body, calls[1].options?.body);
  assert.equal(calls[2].options?.cache, "no-store");
});

test("expired jobs resubmit automatically without changing the scenario", async () => {
  const calls: string[] = [];
  const responses = [Response.json({ id: "expired", status: "running" }), Response.json({ error: "expired" }, { status: 404 }), complete()];
  const send: typeof fetch = async url => { calls.push(String(url)); return responses.shift()!; };
  assert.deepEqual(await requestSimulation("scenario", new AbortController().signal, send), result);
  assert.deepEqual(calls, ["/api/traffic/simulations", "/api/traffic/simulations/expired", "/api/traffic/simulations"]);
});

test("cancelling a waiting request stops retries immediately", async () => {
  const controller = new AbortController();
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    setTimeout(() => controller.abort(), 10);
    return Response.json({ error: "busy" }, { status: 429 });
  };
  await assert.rejects(requestSimulation("scenario", controller.signal, send), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("invalid scenarios and worker failures are reported without retry loops", async () => {
  for (const response of [Response.json({ error: "invalid scenario" }, { status: 400 }), Response.json({ id: "failed", status: "failed", error: "worker failed" })]) {
    let calls = 0;
    await assert.rejects(requestSimulation("scenario", new AbortController().signal, async () => { calls++; return response; }), /invalid scenario|worker failed/);
    assert.equal(calls, 1);
  }
});
