import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { SimulationQueue, parseSimulationOwner } from "./simulation-queue";
import type { SimulationInput, SimulationResult } from "./simulation-types";

class FakeWorker extends EventEmitter {
  terminated = false;
  exited = false;
  terminate() { this.terminated = true; return Promise.resolve(0); }
  exit(code = 0) { if (!this.exited) { this.exited = true; this.emit("exit", code); } }
}

const input = (start: number): SimulationInput => ({ edges: [], nodeCount: 0, profile: [], start, end: start + 1, warmup: 0, step: 1, interval: 1, operations: [], warnings: [] });
const owner = (clientId = "client-0000000001", revision = 1) => ({ clientId, revision });
const result: SimulationResult = { version: "test", start: 0, end: 1, edges: [], operations: [], frames: [], warnings: [], diagnostics: { trips: 0, elapsedMs: 1, maxStorageError: 0, maxBalanceError: 0 }, context: "observed-count estimates" };
function setup(budgetMs = 45000) {
  const workers: FakeWorker[] = [];
  const queue = new SimulationQueue(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, budgetMs);
  return { queue, workers, finish: () => { for (const worker of workers) worker.exit(); } };
}

test("a third scenario waits and starts only after a worker actually exits", () => {
  const { queue, workers, finish } = setup();
  try {
    const first = queue.start(input(0));
    queue.start(input(1));
    const third = queue.start(input(2));
    assert.equal(third.status, "queued");
    assert.equal(workers.length, 2);
    workers[0].emit("message", { result });
    assert.equal(queue.get(first.id)?.status, "complete");
    assert.equal(workers.length, 2);
    workers[0].exit();
    assert.equal(workers.length, 3);
    assert.equal(queue.get(third.id)?.status, "running");
  } finally { finish(); }
});

test("new revisions cancel obsolete work without exceeding two live workers", () => {
  const { queue, workers, finish } = setup();
  try {
    queue.begin(owner());
    const first = queue.start(input(0), owner());
    queue.begin(owner(undefined, 2));
    const second = queue.start(input(1), owner(undefined, 2));
    queue.begin(owner(undefined, 3));
    const latest = queue.start(input(2), owner(undefined, 3));
    assert.equal(workers[0].terminated, true);
    assert.equal(workers[1].terminated, true);
    assert.equal(queue.get(first.id)?.status, "failed");
    assert.equal(queue.get(second.id)?.status, "failed");
    assert.equal(latest.status, "queued");
    workers[0].emit("message", { result });
    assert.equal(queue.get(first.id)?.status, "failed");
    workers[0].exit();
    assert.equal(queue.get(latest.id)?.status, "running");
    assert.equal(workers.length, 3);
  } finally { finish(); }
});

test("cancellation before preparation finishes prevents a late worker from starting", () => {
  const { queue, workers } = setup();
  queue.cancel(owner());
  assert.equal(queue.begin(owner()), false);
  assert.throws(() => queue.start(input(0), owner()), /superseded/);
  assert.equal(workers.length, 0);
});

test("late cancellation and registration cannot replace a newer request", () => {
  const { queue, workers, finish } = setup();
  try {
    queue.begin(owner(undefined, 2));
    const latest = queue.start(input(2), owner(undefined, 2));
    queue.cancel(owner());
    assert.equal(queue.begin(owner()), false);
    assert.equal(queue.get(latest.id)?.status, "running");
    assert.equal(workers[0].terminated, false);
  } finally { finish(); }
});

test("identical scenarios share work and cancelling one client preserves the other", () => {
  const { queue, workers, finish } = setup();
  try {
    const other = owner("client-0000000002");
    queue.begin(owner());
    queue.begin(other);
    const first = queue.start(input(0), owner());
    assert.equal(queue.start(input(0), other).id, first.id);
    queue.cancel(owner());
    assert.equal(workers[0].terminated, false);
    queue.cancel(other);
    assert.equal(workers[0].terminated, true);
    assert.equal(queue.get(first.id)?.status, "failed");
  } finally { finish(); }
});

test("obsolete queued requests are skipped and completed scenarios remain cached", () => {
  const { queue, workers, finish } = setup();
  try {
    queue.start(input(0));
    queue.start(input(1));
    queue.begin(owner());
    const obsolete = queue.start(input(2), owner());
    queue.begin(owner(undefined, 2));
    const latest = queue.start(input(3), owner(undefined, 2));
    workers[0].exit();
    assert.equal(queue.get(obsolete.id)?.status, "failed");
    assert.equal(queue.get(latest.id)?.status, "running");
    workers[2].emit("message", { result });
    workers[2].exit();
    queue.begin(owner(undefined, 3));
    const cached = queue.start(input(3), owner(undefined, 3));
    assert.equal(cached.id, latest.id);
    assert.equal(cached.status, "complete");
    assert.equal(workers.length, 3);
  } finally { finish(); }
});

test("worker failures and timeouts release capacity for queued scenarios", async () => {
  const { queue, workers, finish } = setup(10);
  try {
    const first = queue.start(input(0));
    const second = queue.start(input(1));
    const third = queue.start(input(2));
    workers[0].emit("error", new Error("failure"));
    assert.equal(queue.get(first.id)?.status, "failed");
    workers[0].exit(1);
    assert.equal(queue.get(third.id)?.status, "running");
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.match(queue.get(second.id)?.error ?? "", /processing budget/);
    assert.equal(workers[1].terminated, true);
  } finally { finish(); }
});

test("the waiting queue is bounded and request identifiers are validated", () => {
  const { queue, finish } = setup();
  try {
    for (let i = 0; i < 14; i++) queue.start(input(i));
    assert.throws(() => queue.start(input(14)), /busy/);
    assert.deepEqual(parseSimulationOwner(owner()), owner());
    for (const invalid of [null, {}, owner("short"), owner(undefined, 0), owner(undefined, 1.5), owner(undefined, Number.MAX_SAFE_INTEGER + 1)]) assert.throws(() => parseSimulationOwner(invalid), /identifier/);
  } finally { finish(); }
});
