import type { Disruption } from "../disruptions";
import { profileShare } from "./model";
import { impactedState, scenariosFor, type Impact, type ReroutingPlan } from "./rerouting";
import type { DayType, TrafficData } from "./types";

export type SolverAssignment = {
  id: string; demandHourly: number; unassignedHourly: number;
  routes: { roads: string[]; vehiclesHourly: number; travelMinutes: number }[];
};
export type SolverResult = ReroutingPlan & {
  source: "solver"; iterations: number; converged: boolean; residual: number;
  totalDemandHourly: number; assignedHourly: number; unassignedHourly: number;
  assignments: SolverAssignment[];
};

/** Static, congestion-sensitive route assignment. No external APIs or training.
 * Reuses legal directed detours; smooth best responses and successive averaging
 * account for competing demands on shared roads without claiming exact equilibrium.
 */
export function solveTraffic(data: TrafficData, items: Disruption[], day: DayType, minutes: number,
  options: { maxIterations?: number; tolerance?: number; sensitivityMinutes?: number } = {}): SolverResult {
  const limit = options.maxIterations ?? 100, tolerance = options.tolerance ?? 0.01, sensitivity = options.sensitivityMinutes ?? 2;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance >= 1 || !Number.isFinite(sensitivity) || sensitivity <= 0 || !Number.isFinite(minutes) || minutes < 0 || minutes >= 1440 || !["weekday", "weekend"].includes(day)) throw new Error("Invalid solver settings");
  const started = performance.now();
  const roads = new Map(data.segments.map(s => [s.id, s]));
  const restrictions = new Map<string, Disruption>();
  const events: Disruption[] = [], seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) throw new Error("Duplicate disruption id");
    seen.add(item.id);
    if (item.kind === "event") {
      if (item.attendance !== null && (!Number.isInteger(item.attendance) || item.attendance < 0 || item.attendance > 1000000)) throw new Error("Invalid attendance");
      events.push(item);
    } else {
      if (!roads.has(item.roadId)) throw new Error("Unknown disruption road");
      if (!restrictions.has(item.roadId) || item.restriction === "full-closure") restrictions.set(item.roadId, item);
    }
  }
  const scenarios = scenariosFor(data, [...restrictions.values(), ...events], day, minutes).map(s => ({
    ...s, demand: s.item.kind === "event" ? Math.min(10000, (s.item.attendance ?? 1000) * 0.3) : s.demand,
  }));
  const share = profileShare(data.profiles[day], minutes);
  let weights = scenarios.map(s => s.routes.map(() => 1 / s.routes.length));
  function accumulate(): Record<string, Impact> {
    const impacts: Record<string, Impact> = Object.create(null);
    const impact = (id: string) => impacts[id] ??= { retained: 1, capacityScale: 1, addedHourly: 0 };
    for (const item of restrictions.values()) if (item.kind !== "event") {
      const current = impact(item.roadId);
      current.retained = item.restriction === "full-closure" ? 0 : 0.55;
      current.capacityScale = item.restriction === "full-closure" ? 0 : 0.5;
    }
    scenarios.forEach((s, i) => s.routes.forEach((r, j) => {
      for (const id of r.roads) impact(id).addedHourly += s.demand * weights[i][j];
    }));
    return impacts;
  }
  const timesFor = (impacts: Record<string, Impact>) => scenarios.map(s => s.routes.map(r => r.roads.reduce((sum, id) => {
    const road = roads.get(id)!;
    return sum + road.lengthM / 1000 / Math.max(0.1, impactedState(road, share, day, impacts[id]).speedKmh) * 60;
  }, 0)));
  let iterations = 0, converged = false, residual = 0;
  for (let step = 0; step < limit; step++) {
    const targets = timesFor(accumulate()).map(times => {
      const best = Math.min(...times);
      const scores = times.map(time => Math.exp(-(time - best) / sensitivity));
      const total = scores.reduce((a, b) => a + b, 0);
      return scores.map(score => score / total);
    });
    residual = Math.max(0, ...weights.flatMap((row, i) => row.map((w, j) => Math.abs(w - targets[i][j]))));
    iterations = step + 1;
    if (residual <= tolerance) { converged = true; break; }
    if (iterations === limit) break;
    weights = weights.map((row, i) => row.map((w, j) => w + (targets[i][j] - w) / (step + 2)));
  }
  const impacts = accumulate(), times = timesFor(impacts);
  const perDisruption: Record<string, Record<string, Impact>> = Object.create(null);
  for (const item of restrictions.values()) if (item.kind !== "event") {
    perDisruption[item.id] = { [item.roadId]: { retained: item.restriction === "full-closure" ? 0 : 0.55, capacityScale: item.restriction === "full-closure" ? 0 : 0.5, addedHourly: 0 } };
  }
  scenarios.forEach((s, i) => {
    const id = s.item.kind === "event" ? s.item.id : restrictions.get(s.item.roadId)!.id;
    const contributions = perDisruption[id] ??= Object.create(null);
    s.routes.forEach((route, j) => {
      for (const roadId of route.roads) {
        const contribution = contributions[roadId] ??= { retained: 1, capacityScale: 1, addedHourly: 0 };
        contribution.addedHourly += s.demand * weights[i][j];
      }
    });
  });
  const assignments = scenarios.map((s, i): SolverAssignment => ({
    id: s.item.id, demandHourly: s.demand, unassignedHourly: s.routes.length ? 0 : s.demand,
    routes: s.routes.map((r, j) => ({ roads: r.roads, vehiclesHourly: s.demand * weights[i][j], travelMinutes: times[i][j] })),
  }));
  const totalDemandHourly = assignments.reduce((sum, s) => sum + s.demandHourly, 0);
  const unassignedHourly = assignments.reduce((sum, s) => sum + s.unassignedHourly, 0);
  const elapsedMs = Math.round(performance.now() - started);
  return { source: "solver", impacts, perDisruption, assignments, iterations, converged, residual, elapsedMs,
    totalDemandHourly, assignedHourly: totalDemandHourly - unassignedHourly, unassignedHourly,
    summary: `Traffic solver: ${Object.keys(impacts).length} road segments affected · ${elapsedMs} ms.${unassignedHourly > 0 ? ` ${Math.round(unassignedHourly)} vehicles/hour have no available detour.` : ""}`,
    ...(!converged ? { warning: "Traffic solver reached its iteration limit; showing the current estimate." } : {}),
  };
}
