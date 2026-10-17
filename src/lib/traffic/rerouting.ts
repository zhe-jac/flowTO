import type { Disruption } from "../disruptions";
import { directionState, congestedSpeed, levelFor, profileShare } from "./model";
import { CLASS_ASSUMPTIONS, type DayType, type TrafficData, type TrafficSegment } from "./types";

export type Impact = { addedHourly: number; retained: number; capacityScale: number };
export type RouteOption = { id: string; roads: string[]; minutes: number };
export type Choice = { id: string; weights: number[]; eventVehicles: number };
export type ReroutingPlan = { impacts: Record<string, Impact>; perDisruption?: Record<string, Record<string, Impact>>; source: "solver" | "gemini" | "local"; summary: string; warning?: string; elapsedMs?: number };
type Scenario = { item: Disruption; routes: RouteOption[]; demand: number; retained: number };
const node = (p: number[]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const distance = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 80000, (a[1] - b[1]) * 111000);

class RouteQueue {
  entries: { node: string; cost: number }[] = [];
  push(entry: { node: string; cost: number }) {
    let i = this.entries.length;
    this.entries.push(entry);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.entries[parent].cost <= entry.cost) break;
      this.entries[i] = this.entries[parent]; i = parent;
    }
    this.entries[i] = entry;
  }
  pop() {
    const first = this.entries[0], last = this.entries.pop()!;
    if (this.entries.length) {
      let i = 0;
      while (i * 2 + 1 < this.entries.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.entries.length && this.entries[child + 1].cost < this.entries[child].cost) child++;
        if (this.entries[child].cost >= last.cost) break;
        this.entries[i] = this.entries[child]; i = child;
      }
      this.entries[i] = last;
    }
    return first;
  }
}

/** Directed endpoint graph with legal connections and reduced-capacity streets. */
export function scenariosFor(data: TrafficData, items: Disruption[], day: DayType, minutes: number): Scenario[] {
  const blocked = new Set(items.flatMap(i => i.kind !== "event" && i.restriction === "full-closure" ? [i.roadId] : []));
  const reduced = new Set(items.flatMap(i => i.kind !== "event" && i.restriction === "lane-reduction" ? [i.roadId] : []));
  const graph = new Map<string, { to: string; road: TrafficSegment; cost: number }[]>();
  const destinations = new Set<string>();
  const share = profileShare(data.profiles[day], minutes);
  const add = (from: string, to: string, road: TrafficSegment) => {
    const edges = graph.get(from) ?? [];
    const state = impactedState(road, share, day, reduced.has(road.id) ? { addedHourly: 0, retained: 0.55, capacityScale: 0.5 } : undefined);
    edges.push({ to, road, cost: road.lengthM / 1000 / state.speedKmh * 60 });
    destinations.add(to);
    graph.set(from, edges);
  };
  for (const road of data.segments) {
    if (blocked.has(road.id)) continue;
    const a = node(road.coords[0]), b = node(road.coords.at(-1)!);
    if (road.oneway !== -1) add(a, b, road);
    if (road.oneway !== 1) add(b, a, road);
  }
  // Local bounded Dijkstra; repeated with penalties to offer distinct alternatives.
  function routes(from: string, to: string, avoid?: string, surfaceOnly = false): RouteOption[] {
    if (from === to) return [];
    const result: RouteOption[] = [];
    const penalties = new Map<string, number>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const costs = new Map([[from, 0]]), previous = new Map<string, { from: string; road: string; cost: number }>();
      const queue = new RouteQueue();
      queue.push({ node: from, cost: 0 });
      let reached = false;
      let visited = 0;
      while (queue.entries.length && visited < 10000) {
        const { node: current, cost: best } = queue.pop();
        if (best !== costs.get(current)) continue;
        visited++;
        if (current === to) { reached = true; break; }
        if (best > 30) continue;
        for (const edge of graph.get(current) ?? []) {
          if (edge.road.id === avoid) continue;
          if (surfaceOnly && /Expressway|Ramp/i.test(`${edge.road.cls} ${edge.road.name}`)) continue;
          const cost = best + edge.cost * (penalties.get(edge.road.id) ?? 1);
          if (cost < (costs.get(edge.to) ?? Infinity)) {
            costs.set(edge.to, cost); previous.set(edge.to, { from: current, road: edge.road.id, cost: edge.cost }); queue.push({ node: edge.to, cost });
          }
        }
      }
      if (!reached || !previous.has(to)) break;
      const roads: string[] = []; let cursor = to, travel = 0;
      while (cursor !== from) { const step = previous.get(cursor)!; roads.unshift(step.road); travel += step.cost; cursor = step.from; }
      if (!result.some(r => r.roads.join() === roads.join())) result.push({ id: String(result.length), roads, minutes: travel });
      for (const id of roads) penalties.set(id, (penalties.get(id) ?? 1) * 3);
    }
    return result;
  }
  return items.flatMap<Scenario>(item => {
    if (item.kind === "event") {
      // Venue access is a surface-road endpoint that vehicles can legally enter.
      // Sample surrounding surface approaches instead of choosing only the
      // largest traffic counts (which over-selected nearby expressways).
      const nearby = data.segments.filter(s => !blocked.has(s.id) && !/Expressway|Ramp/i.test(`${s.cls} ${s.name}`) && Math.min(distance(s.coords[0], item.position), distance(s.coords.at(-1)!, item.position)) < 1500);
      const access = nearby.flatMap(s => [s.coords[0], s.coords.at(-1)!]).filter(p => destinations.has(node(p))).sort((a, b) => distance(a, item.position) - distance(b, item.position))[0];
      if (!access) return [{ item, routes: [], demand: 0, retained: 1 }];
      const candidates = nearby.map(s => {
        const first = s.coords[0], last = s.coords.at(-1)!;
        const origin = s.oneway === 1 ? first : s.oneway === -1 ? last : distance(first, access) > distance(last, access) ? first : last;
        const d = distance(origin, item.position);
        const volume = day === "weekday" ? s.weekdayDaily : s.weekendDaily;
        const sector = Math.floor((Math.atan2((origin[1] - item.position[1]) * 111000, (origin[0] - item.position[0]) * 80000) + Math.PI) / (Math.PI / 2)) % 4;
        return { s, origin, d, sector, score: Math.log1p(volume) / (500 + Math.abs(d - 800)) };
      }).filter(c => c.d >= 300 && c.d <= 1800 && node(c.origin) !== node(access)).sort((a, b) => b.score - a.score);
      const selected: typeof candidates = [];
      const names = new Set<string>(), sectors = new Set<number>();
      for (const candidate of candidates) {
        if (names.has(candidate.s.name) || sectors.has(candidate.sector)) continue;
        selected.push(candidate); names.add(candidate.s.name); sectors.add(candidate.sector);
      }
      for (const candidate of candidates) {
        if (selected.length >= 4) break;
        if (!names.has(candidate.s.name)) { selected.push(candidate); names.add(candidate.s.name); }
      }
      const options = selected.flatMap(c => routes(node(c.origin), node(access), undefined, true).slice(0, 1));
      return [{ item, routes: options.map((r, i) => ({ ...r, id: String(i) })), demand: Math.min(10000, (item.attendance ?? 1000) * 0.3), retained: 1 }];
    }
    const road = data.segments.find(s => s.id === item.roadId);
    if (!road) return [];
    const retained = item.restriction === "full-closure" ? 0 : 0.55;
    const state = directionState(road, share, day);
    const first = node(road.coords[0]), last = node(road.coords.at(-1)!);
    const pairs = road.oneway === 0 ? [[first, last], [last, first]] : [road.oneway === 1 ? [first, last] : [last, first]];
    return pairs.map(([from, to], index) => ({ item: { ...item, id: `${item.id}:${index}` }, routes: routes(from, to, road.id), demand: state.flow * (1 - retained), retained }));
  });
}

export function buildPlan(scenarios: Scenario[], choices: Choice[] = [], source: ReroutingPlan["source"] = "local"): ReroutingPlan {
  const impacts: Record<string, Impact> = {};
  const impact = (id: string) => impacts[id] ??= { addedHourly: 0, retained: 1, capacityScale: 1 };
  let stranded = 0;
  for (const scenario of scenarios) {
    const { item, routes, retained } = scenario;
    if (item.kind !== "event") {
      const current = impact(item.roadId);
      current.retained = Math.min(current.retained, retained);
      current.capacityScale = Math.min(current.capacityScale, retained === 0 ? 0 : 0.5);
    }
    const choice = choices.find(c => c.id === item.id);
    const raw = routes.map((r, i) => choice?.weights[i] ?? 1 / Math.max(0.1, r.minutes));
    const total = raw.reduce((a, b) => a + b, 0);
    const demand = item.kind === "event" ? choice?.eventVehicles ?? scenario.demand : scenario.demand;
    if (!routes.length || !total) { stranded += demand; continue; }
    routes.forEach((route, i) => {
      for (const id of route.roads) impact(id).addedHourly += demand * raw[i] / total;
    });
  }
  return { impacts, source, summary: `${source === "gemini" ? "Gemini" : "Local estimate"}: ${Object.keys(impacts).length} road segments affected.${stranded ? " Some demand has no connected detour and remains queued." : ""}` };
}

export function impactedState(segment: TrafficSegment, share: number, day: DayType, impact?: Impact) {
  const base = directionState(segment, share, day);
  if (!impact) return base;
  const flow = base.flow * impact.retained + impact.addedHourly / (segment.oneway === 0 ? 2 : 1);
  const capacity = base.capacity * impact.capacityScale;
  const ratio = capacity > 0 ? flow / capacity : 0;
  return { flow, capacity, ratio, speedKmh: capacity > 0 ? congestedSpeed((CLASS_ASSUMPTIONS[segment.cls] ?? CLASS_ASSUMPTIONS.Local).freeSpeedKmh, ratio) : 0, level: levelFor(ratio) };
}

export function validateChoices(value: unknown, scenarios: Scenario[]): Choice[] {
  if (!Array.isArray(value) || value.length !== scenarios.length) throw new Error("Incomplete Gemini plan");
  const seen = new Set<string>();
  return value.map(c => {
    const scenario = scenarios.find(s => s.item.id === c?.id);
    if (!scenario || seen.has(c.id) || !Array.isArray(c.weights) || c.weights.length !== scenario.routes.length || c.weights.some((w: unknown) => typeof w !== "number" || !Number.isFinite(w) || w < 0 || w > 1) || (c.weights.length && c.weights.reduce((a: number, b: number) => a + b, 0) <= 0) || !Number.isFinite(c.eventVehicles) || c.eventVehicles < 0 || c.eventVehicles > Math.min(10000, (scenario.item.kind === "event" ? scenario.item.attendance ?? 1000 : 0))) throw new Error("Invalid Gemini plan");
    seen.add(c.id);
    return { id: c.id, weights: c.weights, eventVehicles: c.eventVehicles };
  });
}
