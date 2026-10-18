import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { placementStreets, trafficData } from "../src/lib/traffic/server-data";
import { chatDisruptions, type ChatAction } from "../src/lib/traffic/chat";
import { prepareSimulation } from "../src/lib/traffic/simulation-network";
import { sampleSimulation } from "../src/lib/traffic/simulation-plan";
import { simulateNetwork } from "../src/lib/traffic/simulation-engine.mjs";
import type { SimulationInput, SimulationResult } from "../src/lib/traffic/simulation-types";
import type { Impact } from "../src/lib/traffic/rerouting";

const data = await trafficData(), streets = await placementStreets();
const topology = JSON.parse(await readFile("public/data/traffic-topology.json", "utf8"));
const actions: ChatAction[] = [["King", "University", "Yonge"], ["Adelaide", "University", "Yonge"], ["University", "Richmond", "Wellington"]].map(([roadName, fromStreet, toStreet], i) => ({ kind: i === 2 ? "construction" : "closure", title: roadName, roadName, fromStreet, toStreet, restriction: i === 2 ? "lane-reduction" : "full-closure", startMinutes: 735, durationMinutes: 120 }));
const items = chatDisruptions(actions, [], "2026-10-18", streets);
const network = prepareSimulation(data, { items, date: "2026-10-18", minutes: 735, weather: { rainMmPerHour: 0, snowCmPerHour: 0 } }, topology);
const engines: { name: string; simulate: typeof simulateNetwork }[] = [];
if (process.argv[2]) engines.push({ name: "reference", simulate: (await import(pathToFileURL(resolve(process.argv[2])).href)).simulateNetwork });
engines.push({ name: "current", simulate: simulateNetwork });
const cases = [{ name: "none", operations: [] }, ...network.operations.map(operation => ({ name: operation.id === items[0].id ? "King" : operation.id === items[1].id ? "Adelaide" : "University", operations: [operation] })), { name: "all", operations: network.operations }, { name: "reopened-after-30-minutes", operations: network.operations.map(operation => ({ ...operation, end: 765 })) }];
const output: { context: unknown; runs: unknown[] } = { context: { date: "2026-10-18", startsAt: "12:15", weather: "clear", edges: network.edges.length, warmupMinutes: 30, restrictions: items.map(item => ({ label: item.locationLabel, kind: item.kind, restriction: item.kind === "event" ? null : item.restriction })), interpretation: "Approximate reproduction using inferred trips and assumed lanes, not a calibrated real-world forecast. Every case uses the same network, demand, weather and time window." }, runs: [] };
const states = (impacts: Record<string, Impact>) => Object.entries(impacts).flatMap(([id, impact]) => (impact.statesByDirection ?? []).flatMap((state, i) => state ? [{ key: `${id}:${i}`, ...state }] : []));
function summary(result: SimulationResult, minute: number) {
  const plan = sampleSimulation(result, minute), baseline = states(plan.simulation!.baseline), scenario = states({ ...plan.simulation!.baseline, ...plan.impacts });
  const byKey = new Map(baseline.map(state => [state.key, state]));
  return { minute, baselineSevereOpen: baseline.filter(state => state.speedKmh < state.freeSpeedKmh * 0.25).length, scenarioSevereOpen: scenario.filter(state => state.capacity > 0 && state.speedKmh < state.freeSpeedKmh * 0.25).length, additionalSevereOpen: scenario.filter(state => state.capacity > 0 && state.speedKmh < state.freeSpeedKmh * 0.25 && byKey.get(state.key)!.speedKmh >= byKey.get(state.key)!.freeSpeedKmh * 0.25).length, additionalQueuedVehicles: Math.round(scenario.reduce((sum, state) => sum + Math.max(0, state.queueVehicles - byKey.get(state.key)!.queueVehicles), 0)), additionalPending: Math.round(plan.simulation!.ledger.pending - plan.simulation!.baselineLedger.pending), additionalCompleted: Math.round(plan.simulation!.ledger.completed - plan.simulation!.baselineLedger.completed), baselineLedger: plan.simulation!.baselineLedger, scenarioLedger: plan.simulation!.ledger };
}
for (const engine of engines) for (const scenario of cases) {
  const input: SimulationInput = { ...network, start: 720, end: 855, warmup: 30, operations: scenario.operations };
  const result = engine.simulate(input);
  const record = { engine: engine.name, case: scenario.name, version: result.version, diagnostics: result.diagnostics, samples: [734, 750, 765, 795, 855].map(minute => summary(result, minute)) };
  output.runs.push(record);
  console.log(JSON.stringify({ engine: record.engine, case: record.case, elapsedMs: record.diagnostics.elapsedMs, at60Minutes: record.samples[3], at120Minutes: record.samples[4] }));
}
if (process.argv[3]) await writeFile(process.argv[3], JSON.stringify(output, null, 2) + "\n");
