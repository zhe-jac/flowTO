import { DRY_WEATHER, type WeatherRates } from "../weather";
import type { Disruption } from "../disruptions";
import { affectedRoadIds, roadSections, type RoadSection } from "../road-extent";
import { directionState, congestedSpeed, levelForSpeed, profileShare } from "./model";
import type { SimulatedState, SimulationLedger } from "./simulation-types";
import type { DayType, TrafficData, TrafficSegment } from "./types";
import { suppressedVenues, type ActivityContext } from "./activity";
import { disruptionStrength } from "./scenario-timing";

export type Impact = { addedHourly: number; retained: number; capacityScale: number; addedByDirection?: [number, number]; statesByDirection?: [SimulatedState | null, SimulatedState | null]; baselineStatesByDirection?: [SimulatedState | null, SimulatedState | null] };
export type RouteOption = { id: string; roads: string[]; minutes: number; directions?: (1 | -1)[] };
export type Choice = { id: string; weights: number[]; eventVehicles: number };
export type ReroutingPlan = { impacts: Record<string, Impact>; perDisruption?: Record<string, Record<string, Impact>>; unroutedHourly?: number; source: "solver" | "gemini" | "local"; summary: string; warning?: string; elapsedMs?: number; simulation?: { baseline: Record<string, Impact>; closed: string[]; baselineLedger: SimulationLedger; ledger: SimulationLedger; warnings: string[]; minute: number; version: string; runKey?: string } };
export function impactPriority(impact: Impact) {
  let priority = impact.addedHourly + (1 - impact.capacityScale) * 1000;
  impact.statesByDirection?.forEach((state, i) => {
    const base = impact.baselineStatesByDirection?.[i];
    if (state && base) priority += Math.max(0, state.queueVehicles - base.queueVehicles) * 20 + Math.max(0, base.speedKmh - state.speedKmh) * 10;
  });
  return priority;
}
export function validSimulatedStates(value: unknown): value is [SimulatedState | null, SimulatedState | null] {
  return Array.isArray(value) && value.length === 2 && value.every(state => state === null || typeof state === "object" && ["flow", "capacity", "ratio", "speedKmh", "freeSpeedKmh", "queueVehicles", "vehicles", "delaySeconds"].every(key => typeof state[key] === "number" && Number.isFinite(state[key]) && state[key] >= 0 && state[key] <= 1000000) && ["free", "moderate", "heavy", "severe"].includes(state.level));
}
type Scenario = { item: Disruption; sourceId: string; roads: string[]; routes: RouteOption[]; demand: number; retained: number };
type Edge = { to: string; road: TrafficSegment; cost: number; direction: 1 | -1 };
const node = (p: number[]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
const distance = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 80000, (a[1] - b[1]) * 111000);

class RouteQueue {
  private values: { node: string; cost: number }[] = [];
  get size() { return this.values.length; }
  push(node: string, cost: number) {
    const value = { node, cost };
    let index = this.values.length;
    this.values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.values[parent].cost <= cost) break;
      this.values[index] = this.values[parent];
      index = parent;
    }
    this.values[index] = value;
  }
  pop() {
    const first = this.values[0];
    const last = this.values.pop()!;
    if (this.values.length) {
      let index = 0;
      while (index * 2 + 1 < this.values.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1].cost < this.values[child].cost) child++;
        if (last.cost <= this.values[child].cost) break;
        this.values[index] = this.values[child];
        index = child;
      }
      this.values[index] = last;
    }
    return first;
  }
}

export function scenariosFor(data: TrafficData, supplied: Disruption[], day: DayType, minutes: number, weather: WeatherRates = DRY_WEATHER, date?: string): Scenario[] {
  const items = supplied.filter(item => !date || disruptionStrength(item, minutes, minutes, date) > 0);
  const context = { minutes, date, suppressedVenues: suppressedVenues(items) };
  const roads = new Map(data.segments.map(road => [road.id, road]));
  const restrictions = new Map<string, number>();
  const owners = new Map<string, string>();
  for (const item of items) {
    if (item.kind === "event") continue;
    const scale = item.restriction === "full-closure" ? 0 : 0.5;
    for (const id of affectedRoadIds(item)) if (scale < (restrictions.get(id) ?? 1)) {
      restrictions.set(id, scale);
      owners.set(id, item.id);
    }
  }
  const closedJunctions = new Map<string, TrafficSegment[]>();
  for (const [id, scale] of restrictions) {
    const road = roads.get(id);
    if (scale !== 0 || !road) continue;
    for (const point of [road.coords[0], road.coords.at(-1)!]) {
      const key = node(point);
      const edges = closedJunctions.get(key) ?? [];
      edges.push(road);
      closedJunctions.set(key, edges);
    }
  }
  const corridors = new Map<string, RoadSection[]>(), visitedClosed = new Set<string>();
  for (const [id, scale] of restrictions) {
    if (scale !== 0 || visitedClosed.has(id)) continue;
    const component = new Map<string, TrafficSegment>(), pending = [id];
    while (pending.length) {
      const current = pending.pop()!;
      if (component.has(current)) continue;
      const road = roads.get(current);
      if (!road) continue;
      component.set(current, road);
      visitedClosed.add(current);
      for (const point of [road.coords[0], road.coords.at(-1)!]) for (const neighbour of closedJunctions.get(node(point)) ?? []) if (!component.has(neighbour.id)) pending.push(neighbour.id);
    }
    const junctions = new Set([...component.values()].flatMap(road => [node(road.coords[0]), node(road.coords.at(-1)!)]));
    const terminals = [...junctions].filter(key => closedJunctions.get(key)?.length === 1);
    if (terminals.length !== 2 || [...junctions].some(key => closedJunctions.get(key)!.length > 2)) continue;
    const ordered: RoadSection[] = [], used = new Set<string>();
    let cursor = terminals[0];
    while (cursor !== terminals[1]) {
      const road = closedJunctions.get(cursor)!.find(edge => !used.has(edge.id));
      if (!road) break;
      const forward = node(road.coords[0]) === cursor;
      ordered.push({ roadId: road.id, from: forward ? 0 : 1, to: forward ? 1 : 0 });
      used.add(road.id);
      cursor = node(forward ? road.coords.at(-1)! : road.coords[0]);
    }
    if (used.size === component.size) for (const roadId of component.keys()) corridors.set(roadId, ordered);
  }
  const graph = new Map<string, Edge[]>();
  const share = profileShare(data.profiles[day], minutes);
  const add = (from: string, to: string, road: TrafficSegment, direction: 1 | -1) => {
    const edges = graph.get(from) ?? [];
    const state = directionState(road, share, day, weather, context);
    const speed = congestedSpeed(state.freeSpeedKmh, state.ratio / (restrictions.get(road.id) ?? 1));
    edges.push({ to, road, direction, cost: road.lengthM / 1000 / speed * 60 });
    graph.set(from, edges);
  };
  for (const road of data.segments) {
    if (restrictions.get(road.id) === 0) continue;
    const a = node(road.coords[0]), b = node(road.coords.at(-1)!);
    if (road.oneway !== -1) add(a, b, road, 1);
    if (road.oneway !== 1) add(b, a, road, -1);
  }
  function routes(from: string, to: string, excluded: ReadonlySet<string> = new Set()): RouteOption[] {
    if (from === to) return [];
    const result: RouteOption[] = [];
    const penalties = new Map<string, number>();
    for (let attempt = 0; attempt < 3; attempt++) {
      const costs = new Map([[from, 0]]);
      const previous = new Map<string, { from: string; edge: Edge }>();
      const queue = new RouteQueue();
      queue.push(from, 0);
      let visited = 0, reached = false;
      while (queue.size && visited++ < 12000) {
        const { node: current, cost: best } = queue.pop();
        if (best !== costs.get(current)) continue;
        if (current === to) { reached = true; break; }
        if (best > 60) continue;
        for (const edge of graph.get(current) ?? []) {
          if (excluded.has(edge.road.id)) continue;
          const cost = best + edge.cost * (penalties.get(edge.road.id) ?? 1);
          if (cost < (costs.get(edge.to) ?? Infinity)) {
            costs.set(edge.to, cost);
            previous.set(edge.to, { from: current, edge });
            queue.push(edge.to, cost);
          }
        }
      }
      if (!reached) break;
      const roads: string[] = [], directions: (1 | -1)[] = [];
      let cursor = to, travel = 0;
      while (cursor !== from) {
        const step = previous.get(cursor)!;
        roads.unshift(step.edge.road.id);
        directions.unshift(step.edge.direction);
        travel += step.edge.cost;
        cursor = step.from;
      }
      if (!result.some(route => route.roads.join() === roads.join())) result.push({ id: String(result.length), roads, directions, minutes: travel });
      for (const id of roads) penalties.set(id, (penalties.get(id) ?? 1) * 3);
    }
    return result;
  }
  return items.flatMap<Scenario>(item => {
    if (item.kind === "event") {
      const nearby = data.segments.filter(road => restrictions.get(road.id) !== 0 && distance(road.coords[0], item.position) < 1500);
      const venue = [...nearby].sort((a, b) => distance(a.coords[0], item.position) - distance(b.coords[0], item.position))[0];
      if (!venue) return [{ item, sourceId: item.id, roads: [], routes: [], demand: 0, retained: 1 }];
      const approaches = [...nearby].sort((a, b) => (day === "weekday" ? b.weekdayDaily - a.weekdayDaily : b.weekendDaily - a.weekendDaily)).filter((road, index, all) => all.findIndex(other => other.name === road.name) === index).slice(0, 4);
      const options = approaches.flatMap(road => routes(node(road.coords[0]), node(venue.coords[0])).slice(0, 1));
      return [{ item, sourceId: item.id, roads: [], routes: options.map((route, index) => ({ ...route, id: String(index) })), demand: Math.min(10000, (item.attendance ?? 1000) * 0.3), retained: 1 }];
    }
    const affected = affectedRoadIds(item);
    const connected = item.restriction === "full-closure" ? corridors.get(affected[0]) : undefined;
    const sections = connected && affected.every(id => connected.some(section => section.roadId === id)) ? connected : roadSections(item);
    const corridor = sections.map(section => roads.get(section.roadId));
    if (corridor.some(road => !road)) return [];
    const segments = corridor as TrafficSegment[];
    const ids = segments.map(road => road.id);
    const retained = item.restriction === "full-closure" ? 0 : 0.55;
    const owned = affected.filter(id => owners.get(id) === item.id).length / ids.length;
    const first = segments[0], last = segments.at(-1)!;
    const start = node(sections[0].to > sections[0].from ? first.coords[0] : first.coords.at(-1)!);
    const finish = node(sections.at(-1)!.to > sections.at(-1)!.from ? last.coords.at(-1)! : last.coords[0]);
    const demand = (directionState(first, share, day, weather, context).flow + directionState(last, share, day, weather, context).flow) / 2 * (1 - retained) * owned;
    const pairs: [string, string][] = [];
    for (const reverse of [false, true]) {
      if (segments.every((road, index) => road.oneway === 0 || road.oneway === (sections[index].to > sections[index].from ? 1 : -1) * (reverse ? -1 : 1))) pairs.push(reverse ? [finish, start] : [start, finish]);
    }
    if (!pairs.length || !owned) return [{ item, sourceId: item.id, roads: affected, routes: [], demand: 0, retained }];
    return pairs.map(([from, to], index) => ({ item: { ...item, id: `${item.id}:${index}` }, sourceId: item.id, roads: affected, routes: routes(from, to, new Set(ids)), demand, retained }));
  });
}

export function mergeImpact(target: Impact, source: Impact) {
  if (source.addedByDirection || target.addedByDirection) {
    const a = target.addedByDirection ?? [target.addedHourly / 2, target.addedHourly / 2];
    const b = source.addedByDirection ?? [source.addedHourly / 2, source.addedHourly / 2];
    target.addedByDirection = [a[0] + b[0], a[1] + b[1]];
  }
  target.addedHourly += source.addedHourly;
  target.retained = Math.min(target.retained, source.retained);
  target.capacityScale = Math.min(target.capacityScale, source.capacityScale);
  return target;
}

export function buildPlan(scenarios: Scenario[], choices: Choice[] = [], source: ReroutingPlan["source"] = "local"): ReroutingPlan {
  const impacts: Record<string, Impact> = {}, perDisruption: Record<string, Record<string, Impact>> = {};
  let unroutedHourly = 0;
  for (const scenario of scenarios) {
    const { item, routes, retained } = scenario;
    const contribution = perDisruption[scenario.sourceId] ??= {};
    const impact = (id: string) => contribution[id] ??= { addedHourly: 0, retained: 1, capacityScale: 1 };
    if (item.kind !== "event") for (const id of scenario.roads) {
      const current = impact(id);
      current.retained = Math.min(current.retained, retained);
      current.capacityScale = Math.min(current.capacityScale, retained === 0 ? 0 : 0.5);
    }
    const choice = choices.find(value => value.id === item.id);
    const raw = routes.map((route, index) => choice?.weights[index] ?? 1 / Math.max(0.1, route.minutes));
    const total = raw.reduce((a, b) => a + b, 0);
    const demand = item.kind === "event" ? choice?.eventVehicles ?? scenario.demand : scenario.demand;
    if (!routes.length || !total) { unroutedHourly += demand; continue; }
    let assigned = 0;
    routes.forEach((route, index) => {
      const demandOnRoute = index === routes.length - 1 ? Math.max(0, demand - assigned) : demand * raw[index] / total;
      assigned += demandOnRoute;
      route.roads.forEach((id, step) => {
        const current = impact(id);
        current.addedHourly += demandOnRoute;
        if (route.directions) {
          current.addedByDirection ??= [0, 0];
          current.addedByDirection[route.directions[step] === 1 ? 0 : 1] += demandOnRoute;
        }
      });
    });
  }
  for (const contribution of Object.values(perDisruption)) for (const [id, impact] of Object.entries(contribution)) mergeImpact(impacts[id] ??= { addedHourly: 0, retained: 1, capacityScale: 1 }, impact);
  return { impacts, perDisruption, unroutedHourly, source, summary: `${source === "gemini" ? "Gemini" : "Local estimate"}: ${Object.keys(impacts).length} road segments affected.${unroutedHourly ? ` ${Math.round(unroutedHourly).toLocaleString()} vehicles/hour have no connected detour; queue growth is not simulated.` : ""}` };
}

export function impactedState(segment: TrafficSegment, share: number, day: DayType, impact?: Impact, weather: WeatherRates = DRY_WEATHER, context?: ActivityContext, direction?: 1 | -1) {
  if (impact?.statesByDirection) {
    const states = impact.statesByDirection.filter((state): state is SimulatedState => state !== null);
    const state = direction ? impact.statesByDirection[direction === 1 ? 0 : 1] : states.sort((a, b) => a.speedKmh - b.speedKmh)[0];
    if (state) return state;
  }
  const base = directionState(segment, share, day, weather, context);
  if (!impact) return base;
  const added = impact.addedByDirection && (direction || segment.oneway !== 0) ? impact.addedByDirection[(direction ?? segment.oneway) === 1 ? 0 : 1] : impact.addedHourly / (segment.oneway === 0 ? 2 : 1);
  const flow = base.flow * impact.retained + added;
  const capacity = base.capacity * impact.capacityScale;
  const ratio = capacity > 0 ? flow / capacity : 0;
  const speedKmh = capacity > 0 ? congestedSpeed(base.freeSpeedKmh, ratio) : 0;
  return { flow, capacity, ratio, freeSpeedKmh: base.freeSpeedKmh, speedKmh, level: levelForSpeed(speedKmh, base.freeSpeedKmh) };
}

export function impactedDirectionStates(segment: TrafficSegment, share: number, day: DayType, impact?: Impact, weather: WeatherRates = DRY_WEATHER, context?: ActivityContext) {
  const directions: (1 | -1)[] = segment.oneway === 0 ? [1, -1] : [segment.oneway];
  return directions.map(direction => ({ direction, state: impactedState(segment, share, day, impact, weather, context, direction) })).sort((a, b) => a.state.speedKmh - b.state.speedKmh || b.state.ratio - a.state.ratio);
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
