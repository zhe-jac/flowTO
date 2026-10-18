import type { SimulationFrame, SimulationResult, SimulatedState } from "./simulation-types";
import { levelForSpeed } from "./model";
import type { Impact, ReroutingPlan } from "./rerouting";

function unpack(frame: SimulationFrame) {
  const raw = typeof atob === "function" ? atob(frame.values) : Buffer.from(frame.values, "base64").toString("binary");
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  return new Uint16Array(bytes.buffer);
}

export function sampleSimulation(result: SimulationResult, minutes: number): ReroutingPlan {
  let index = result.frames.findIndex(frame => frame.minute >= minutes);
  if (index < 0) index = result.frames.length - 1;
  const after = result.frames[index], before = result.frames[Math.max(0, index - 1)];
  const b = unpack(before), a = before === after ? b : unpack(after);
  const mix = after.minute === before.minute ? 1 : Math.max(0, Math.min(1, (minutes - before.minute) / (after.minute - before.minute)));
  const baseline: Record<string, Impact> = {}, impacts: Record<string, Impact> = {};
  const active = result.frames.filter(frame => frame.minute <= minutes).at(-1) ?? before;
  const closed = new Set<string>();
  const capacityScales: Record<string, number> = {};
  for (const operation of result.operations) if (operation.kind !== "event" && minutes >= operation.start && minutes < operation.end) for (const i of operation.edges) {
    const id = result.edges[i].id;
    capacityScales[id] = Math.min(capacityScales[id] ?? 1, operation.capacity);
    if (operation.capacity === 0) closed.add(id);
  }
  for (let i = 0; i < result.edges.length; i++) {
    const edge = result.edges[i];
    const state = (scenario: boolean): SimulatedState => {
      const offset = i * 8 + (scenario ? 4 : 0);
      const value = (k: number, scale: number) => (b[offset + k] + (a[offset + k] - b[offset + k]) * mix) / scale;
      const flow = value(0, 1), speedKmh = value(1, 100), queueVehicles = value(2, 10), vehicles = value(3, 10);
      const capacity = edge.capacity * (scenario ? capacityScales[edge.id] ?? 1 : 1);
      return { flow, speedKmh, queueVehicles, vehicles, capacity, ratio: capacity ? flow / capacity : 0, freeSpeedKmh: edge.speed, level: levelForSpeed(speedKmh, edge.speed), delaySeconds: Math.max(0, edge.length / Math.max(0.1, speedKmh / 3.6) - edge.length / (edge.speed / 3.6)) };
    };
    const normal = state(false), changed = state(true), direction = edge.direction === 1 ? 0 : 1;
    const base = baseline[edge.id] ??= { retained: 1, capacityScale: 1, addedHourly: 0, statesByDirection: [null, null] };
    base.statesByDirection![direction] = normal;
    const impact = impacts[edge.id] ??= { retained: closed.has(edge.id) ? 0 : 1, capacityScale: capacityScales[edge.id] ?? 1, addedHourly: 0, addedByDirection: [0, 0], statesByDirection: [null, null], baselineStatesByDirection: [null, null] };
    impact.statesByDirection![direction] = changed;
    impact.baselineStatesByDirection![direction] = normal;
    impact.addedByDirection![direction] = Math.max(0, changed.flow - normal.flow);
    impact.addedHourly += Math.max(0, changed.flow - normal.flow);
  }
  for (const id of Object.keys(impacts)) {
    const different = impacts[id].statesByDirection!.some((state, d) => {
      const base = baseline[id].statesByDirection![d];
      return state && base && (Math.abs(state.speedKmh - base.speedKmh) > 0.5 || Math.abs(state.flow - base.flow) > 2 || Math.abs(state.queueVehicles - base.queueVehicles) > 0.1);
    });
    if (!different && !closed.has(id) && impacts[id].capacityScale === 1) delete impacts[id];
  }
  return { impacts, source: "solver", summary: `Dynamic local estimate · ${Math.round(active.scenario.onNetwork).toLocaleString()} vehicles in the modeled area`, simulation: { baseline, closed: [...closed], baselineLedger: active.baseline, ledger: active.scenario, warnings: result.warnings, minute: minutes, version: result.version }, elapsedMs: result.diagnostics.elapsedMs };
}
