import assert from "node:assert/strict";
import { test } from "node:test";
import { createRoutePlanner, inferTrips, movementLanes, simulateNetwork } from "./simulation-engine.mjs";
import { sampleSimulation } from "./simulation-plan";
import { comparisonImpacts } from "./comparison";
import { congestionForState } from "./model";
import type { SimulationEdge, SimulationInput } from "./simulation-types";

const edge = (id: string, from: number, to: number, daily = 14400, capacity = 900, storage = 12): SimulationEdge => ({ id, from, to, daily, capacity, storage, direction: 1, length: 120, speed: 40, lanes: 1 });
const input = (edges: SimulationEdge[], operations: SimulationInput["operations"] = []): SimulationInput => ({ edges, nodeCount: Math.max(...edges.flatMap(e => [e.from, e.to])) + 1, operations, profile: new Array(96).fill(1 / 96), start: 0, end: 40, warmup: 10, step: 2, interval: 1, warnings: [] });
const state = (result: ReturnType<typeof simulateNetwork>, minute: number, road: string) => sampleSimulation(result, minute).impacts[road]?.statesByDirection?.[0];

test("turning movements share lanes conservatively while straight traffic can use the remaining lane", () => {
  const approach = { ...edge("approach", 0, 1), lanes: 2, exitBearing: 0 };
  assert.deepEqual(movementLanes(approach, { ...edge("left", 1, 2), entryBearing: 90 }), [0]);
  assert.deepEqual(movementLanes(approach, { ...edge("right", 1, 3), entryBearing: -90 }), [1]);
  assert.deepEqual(movementLanes(approach, { ...edge("straight", 1, 4), entryBearing: 0 }), [0, 1]);
  assert.deepEqual(movementLanes({ ...approach, lanes: 1 }, { ...edge("left", 1, 2), entryBearing: 90 }), [0]);
});

test("a blocked turn stops its shared lane without stopping an independent lane", () => {
  const network = (lanes: number) => [{ ...edge("approach", 0, 1, 14400, 1200, 40), lanes, length: 500, exitBearing: 0 }, { ...edge("left", 1, 2, 7200, 600, 15), entryBearing: 90 }, { ...edge("straight", 1, 3, 7200, 600, 15), entryBearing: 0 }];
  const operation = { id: "left closure", kind: "closure" as const, edges: [1], start: 5, end: 25, capacity: 0, vehicles: 0 };
  const two = simulateNetwork(input(network(2), [operation])), one = simulateNetwork(input(network(1), [operation]));
  const flow = (result: typeof two) => { const plan = sampleSimulation(result, 15); return (plan.impacts.straight ?? plan.simulation!.baseline.straight).statesByDirection![0]!.flow; };
  assert.ok(flow(two) > 200, String(flow(two)));
  assert.ok(flow(one) < 50, String(flow(one)));
  assert.ok(two.diagnostics.maxStorageError < 1e-6);
  assert.ok(two.diagnostics.maxBalanceError < 1e-6);
  assert.equal(sampleSimulation(two, 15).impacts.left.statesByDirection![0]!.flow, 0);
});

test("complete detours avoid closed links and visited nodes without changing previously returned routes", () => {
  const edges = [edge("closed", 0, 5), edge("start", 0, 1), edge("cycle", 1, 0), edge("past", 1, 2), edge("past-exit", 2, 5), edge("safe", 1, 3), edge("safe-exit", 3, 5)];
  const planner = createRoutePlanner(edges, 6);
  planner.update(edges.map(() => 1), [0, 1, 1, 1, 1, 1, 1]);
  const route = planner.route(0, 5, { visited: [2] });
  assert.deepEqual(route?.path, [1, 5, 6]);
  const nodes = [0, ...route!.path.map(i => edges[i].to)];
  assert.equal(new Set(nodes).size, nodes.length);
  planner.update(edges.map(() => 1), edges.map(() => 1));
  assert.deepEqual(planner.route(0, 5)?.path, [0]);
  assert.deepEqual(route?.path, [1, 5, 6]);
});

test("routing costs and permissions are held as one immutable snapshot", () => {
  const edges = [edge("a", 0, 1), edge("b", 1, 3), edge("c", 0, 2), edge("d", 2, 3)];
  const planner = createRoutePlanner(edges, 4), costs = [1, 1, 5, 5], permissions = [1, 1, 1, 1];
  planner.update(costs, permissions);
  costs[0] = 1000; permissions[0] = 0;
  assert.deepEqual(planner.route(0, 3)?.path, [0, 1]);
  planner.update(costs, permissions);
  assert.deepEqual(planner.route(0, 3)?.path, [2, 3]);
});

test("a closure in another component does not reroute unrelated baseline congestion", () => {
  const edges = [edge("busy", 0, 1, 24000, 400), edge("busy-out", 1, 2, 24000, 400), edge("alternative", 0, 3, 100), edge("alternative-out", 3, 2, 100), edge("isolated", 4, 5, 1000)];
  const result = simulateNetwork(input(edges, [{ id: "elsewhere", kind: "closure", edges: [4], start: 5, end: 30, capacity: 0, vehicles: 0 }]));
  const plan = sampleSimulation(result, 20);
  for (const id of ["busy", "busy-out", "alternative", "alternative-out"]) assert.equal(plan.impacts[id], undefined, id);
});

test("new departures return to their original corridor after its closure clears", () => {
  const edges = [edge("main", 0, 1, 7200, 1200), edge("detour-a", 0, 2, 100, 1200), edge("detour-b", 2, 1, 100, 1200)];
  const result = simulateNetwork(input(edges, [{ id: "closure", kind: "closure", edges: [0], start: 5, end: 10, capacity: 0, vehicles: 0 }]));
  const plan = sampleSimulation(result, 30);
  assert.equal(plan.impacts.main, undefined);
  assert.equal(plan.impacts["detour-a"], undefined);
  assert.equal(plan.impacts["detour-b"], undefined);
});

test("vehicles already on a closed approach can change into a usable turn lane without disappearing", () => {
  const edges = [{ ...edge("approach", 0, 1, 14400, 1200, 40), length: 500, lanes: 2, exitBearing: 0 }, { ...edge("closed", 1, 2), entryBearing: 0 }, { ...edge("left-detour", 1, 3, 1000, 1200), entryBearing: 90 }, edge("detour-out", 3, 2, 1000, 1200)];
  const result = simulateNetwork(input(edges, [{ id: "closure", kind: "closure", edges: [1], start: 5, end: 20, capacity: 0, vehicles: 0 }]));
  assert.ok(result.diagnostics.routing!.laneChanges > 0);
  assert.ok(result.diagnostics.maxBalanceError < 1e-6);
  assert.ok(result.diagnostics.maxStorageError < 1e-6);
  assert.ok(sampleSimulation(result, 15).impacts["left-detour"].addedHourly > 0);
});

test("venue arrivals and departures retain vehicle accounting with committed routes", () => {
  const scenario = input([edge("in", 0, 1, 1000), edge("out", 1, 2, 1000), edge("return", 2, 0, 1000)], [{ id: "event", kind: "event", edges: [], destination: 2, origins: [0], vehicles: 300, start: 30, end: 60, capacity: 1 }]);
  scenario.end = 90;
  const result = simulateNetwork(scenario), frame = result.frames.at(-1)!;
  assert.ok(frame.scenario.generated > frame.baseline.generated + 100);
  assert.ok(frame.scenario.completed > frame.baseline.completed + 100);
  assert.ok(result.diagnostics.maxBalanceError < 1e-6);
  assert.ok(result.diagnostics.maxStorageError < 1e-6);
});

test("closing one direction preserves opposite capacity and does not mark the whole street closed", () => {
  const result = simulateNetwork(input([edge("a", 0, 1), { ...edge("a", 1, 0), direction: -1 }], [{ id: "east", kind: "closure", edges: [0], start: 5, end: 30, capacity: 0, vehicles: 0 }]));
  const plan = sampleSimulation(result, 20);
  assert.deepEqual(plan.simulation!.closed, []);
  assert.equal(plan.impacts.a.statesByDirection![0]!.capacity, 0);
  assert.equal(plan.impacts.a.statesByDirection![1]!.capacity, 900);
  assert.deepEqual(plan.impacts.a.statesByDirection![1], plan.impacts.a.baselineStatesByDirection![1]);
});

test("inferred connected trips reproduce every supplied link total without duplicating flow", () => {
  const edges = [edge("a", 0, 1), edge("b", 1, 2, 10000), edge("c", 1, 3, 4400)];
  const trips = inferTrips(edges, 4);
  const totals = edges.map((_, i) => trips.reduce((sum, trip) => sum + (trip.path.includes(i) ? trip.daily : 0), 0));
  assert.deepEqual(totals, edges.map(e => e.daily));
  assert.ok(trips.some(t => t.path.length > 1));
});

test("an unmodified network has identical matched baseline and scenario states", () => {
  const result = simulateNetwork(input([edge("a", 0, 1), edge("b", 1, 2)]));
  assert.deepEqual(sampleSimulation(result, 20).impacts, {});
  assert.ok(result.diagnostics.maxBalanceError < 1e-6);
  assert.equal(result.diagnostics.maxStorageError, 0);
});

test("capacity loss creates stored queues, upstream spillback and recovery after reopening", () => {
  const result = simulateNetwork(input([edge("approach", 0, 1, 14400, 900, 15), edge("bottleneck", 1, 2, 14400, 900, 8)], [{ id: "works", kind: "construction", edges: [1], start: 5, end: 15, capacity: 0.2, vehicles: 0 }]));
  const during = state(result, 14, "approach");
  assert.ok(during && during.queueVehicles > 1);
  const after = state(result, 16, "approach");
  assert.ok(after && after.queueVehicles > 1);
  const recovered = state(result, 38, "approach");
  assert.ok(!recovered || recovered.queueVehicles < after.queueVehicles);
  assert.ok(result.frames.some(frame => frame.scenario.pending > frame.baseline.pending + 1));
  assert.ok(result.diagnostics.maxBalanceError < 1e-6);
  assert.equal(result.diagnostics.maxStorageError, 0);
});

test("a full closure diverts trips to a legal alternative without crossing the closed edge", () => {
  const result = simulateNetwork(input([edge("in", 0, 1), edge("closed", 1, 2), edge("out", 2, 3), edge("detour1", 1, 4, 1000), edge("detour2", 4, 2, 1000)], [{ id: "closure", kind: "closure", edges: [1], start: 5, end: 30, capacity: 0, vehicles: 0 }]));
  const frame = sampleSimulation(result, 20);
  assert.ok(frame.simulation!.closed.includes("closed"));
  assert.equal(frame.impacts.closed.statesByDirection![0]!.flow, 0);
  assert.ok(frame.impacts.detour1.addedHourly > 100);
  assert.ok(result.diagnostics.maxBalanceError < 1e-6);
});

test("unroutable departures remain pending and do not disappear", () => {
  const result = simulateNetwork(input([edge("only", 0, 1)], [{ id: "closure", kind: "closure", edges: [0], start: 0, end: 30, capacity: 0, vehicles: 0 }]));
  const frame = result.frames.find(f => f.minute >= 20)!;
  assert.ok(frame.scenario.pending > 100);
  assert.ok(Math.abs(frame.scenario.generated - frame.scenario.completed - frame.scenario.onNetwork - frame.scenario.pending) < 1e-6);
});

test("dynamic comparisons preserve computed queues after operations end", () => {
  const result = simulateNetwork(input([edge("a", 0, 1), edge("b", 1, 2)], [{ id: "closure", kind: "closure", edges: [1], start: 5, end: 15, capacity: 0, vehicles: 0 }]));
  const plan = sampleSimulation(result, 16);
  const comparison = comparisonImpacts(plan, [], new Map(), 16, "after");
  assert.equal(comparison.closed.size, 0);
  assert.ok(comparison.impacts.a.statesByDirection![0]!.queueVehicles > 0);
  assert.ok(comparisonImpacts(plan, [], new Map(), 16, "before").impacts.a.statesByDirection![0]!.queueVehicles < comparison.impacts.a.statesByDirection![0]!.queueVehicles);
});

test("congestion color follows physical speed and reaches maximum only at slow traffic", () => {
  assert.ok(congestionForState({ speedKmh: 36, freeSpeedKmh: 40 }) < 1);
  assert.equal(congestionForState({ speedKmh: 0, freeSpeedKmh: 40 }), 3);
});

test("a future restriction cannot alter an already congested baseline before onset", () => {
  const result = simulateNetwork(input([edge("a", 0, 1, 24000, 400), edge("b", 1, 2, 24000, 400)], [{ id: "future", kind: "closure", edges: [1], start: 20, end: 30, capacity: 0, vehicles: 0 }]));
  assert.deepEqual(sampleSimulation(result, 19).impacts, {});
  assert.ok(sampleSimulation(result, 19).simulation!.baselineLedger.pending > 0);
});

test("closure permissions end exactly at the scheduled minute while queues persist", () => {
  const result = simulateNetwork(input([edge("a", 0, 1), edge("b", 1, 2)], [{ id: "closure", kind: "closure", edges: [1], start: 5, end: 15, capacity: 0, vehicles: 0 }]));
  assert.deepEqual(sampleSimulation(result, 5).simulation!.closed, ["b"]);
  assert.deepEqual(sampleSimulation(result, 15).simulation!.closed, []);
  assert.ok(sampleSimulation(result, 15).simulation!.ledger.pending > 0);
});

test("overlapping restrictions apply jointly without duplicating trip generation", () => {
  const operation = { id: "closure", kind: "closure" as const, edges: [1], start: 5, end: 15, capacity: 0, vehicles: 0 };
  const network = [edge("a", 0, 1), edge("b", 1, 2)];
  const single = simulateNetwork(input(network, [operation]));
  const overlap = simulateNetwork(input(network, [operation, { ...operation, id: "duplicate" }]));
  assert.deepEqual(overlap.frames, single.frames);
});

test("pending demand is eventually served after reopening when capacity exceeds arrivals", () => {
  const scenario = input([edge("only", 0, 1, 7200, 1200)], [{ id: "closure", kind: "closure", edges: [0], start: 0, end: 10, capacity: 0, vehicles: 0 }]);
  const result = simulateNetwork(scenario);
  const during = result.frames.find(frame => frame.minute === 10)!;
  const recovered = result.frames.at(-1)!;
  assert.ok(during.scenario.pending > 40);
  assert.ok(recovered.scenario.pending < 0.01);
  assert.ok(Math.abs(recovered.scenario.completed - recovered.baseline.completed) < 1);
});
