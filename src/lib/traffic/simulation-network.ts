import { affectedRoadIds } from "../road-extent";
import { CLASS_ASSUMPTIONS, type TrafficData } from "./types";
import { shiftSimulationDate, simulationDayType } from "./simulation-date";
import { disruptionWindow } from "./scenario-timing";
import { capacityPerDirection } from "./model";
import { weatherFactors } from "./weather";
import { roadTravelDirections } from "./road-travel";
import type { SimulationInput, SimulationRequest, SimulationEdge, SimulationOperation } from "./simulation-types";

export function prepareSimulation(data: TrafficData, request: SimulationRequest, topology: Record<string, [string, string]> = {}): SimulationInput {
  const byId = new Map(data.segments.map(road => [road.id, road]));
  const anchors = request.items.flatMap(item => item.kind === "event" ? [item.position] : affectedRoadIds(item).flatMap(id => byId.get(id)?.coords ?? []));
  if (!anchors.length) throw new Error("Add a disruption to run a simulation.");
  const boxes = request.items.map(item => {
    const points = item.kind === "event" ? [item.position] : affectedRoadIds(item).flatMap(id => byId.get(id)?.coords ?? []);
    if (!points.length) throw new Error("A selected street is unavailable.");
    return [Math.min(...points.map(p => p[0])) - 0.009, Math.min(...points.map(p => p[1])) - 0.0065, Math.max(...points.map(p => p[0])) + 0.009, Math.max(...points.map(p => p[1])) + 0.0065];
  });
  const roads = data.segments.filter(road => road.coords.some(p => boxes.some(b => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3])));
  const nodes = new Map<string, number>();
  const node = (key: string) => { if (!nodes.has(key)) nodes.set(key, nodes.size); return nodes.get(key)!; };
  const coordinateKey = (p: number[]) => `xy:${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const edges: SimulationEdge[] = [];
  const warnings = new Set<string>(["Demand is inferred from historical counts; turns, lane counts and signal capacity remain estimates.", "The simulation uses a buffered local network. Trips unable to leave it remain accounted for as pending demand."]);
  const day = simulationDayType(request.date);
  const minute = (value: number) => Math.floor(value / 60) * 60;
  const start = minute(request.minutes) - 30;
  const end = start + 150;
  for (const road of roads) {
    const ids = topology[road.id];
    const from = node(ids ? `tcl:${ids[0]}` : coordinateKey(road.coords[0]));
    const to = node(ids ? `tcl:${ids[1]}` : coordinateKey(road.coords.at(-1)!));
    if (from === to) continue;
    const assumption = CLASS_ASSUMPTIONS[road.cls] ?? CLASS_ASSUMPTIONS.Local;
    const factors = weatherFactors(road.cls, request.weather);
    const lanes = road.oneway === 0 ? assumption.lanes : assumption.onewayLanes;
    const daily = (day === "weekday" ? road.weekdayDaily : road.weekendDaily) / (road.oneway === 0 ? 2 : 1);
    const add = (direction: 1 | -1) => edges.push({ id: road.id, direction, from: direction === 1 ? from : to, to: direction === 1 ? to : from, length: Math.max(road.lengthM, 1), speed: assumption.freeSpeedKmh * factors.speed, capacity: capacityPerDirection(road) * factors.capacity, storage: Math.max(1, road.lengthM * lanes / 7.5), daily, dailyByDay: [road.weekdayDaily / (road.oneway === 0 ? 2 : 1), road.weekendDaily / (road.oneway === 0 ? 2 : 1)], lanes });
    if (road.oneway !== -1) add(1);
    if (road.oneway !== 1) add(-1);
    if (road.weekdayDaily < 100 && road.source.kind === "intersection") warnings.add("Some surveyed streets have very low observed traffic, possibly reflecting existing restrictions. These observations have been preserved.");
  }
  if (edges.length > 6500) throw new Error("This scenario spans too much of the city. Use a smaller connected area for the local simulation.");
  const operations: SimulationOperation[] = request.items.map(item => {
    const window = disruptionWindow(item, request.minutes, request.date);
    const affected = new Set(item.kind === "event" ? [] : affectedRoadIds(item));
    const directions = item.kind === "event" ? null : roadTravelDirections(item, id => byId.get(id)?.coords);
    const selected = edges.flatMap((edge, index) => affected.has(edge.id) && (!directions || directions.get(edge.id) === edge.direction) ? [index] : []);
    if (item.kind !== "event" && !selected.length) throw new Error(directions ? "The selected street does not support that travel direction. Check its extent and direction." : "A selected street is outside the simulation network.");
    const nearest = item.kind === "event" ? roads.reduce((best, road) => {
      const score = Math.hypot((road.coords[0][0] - item.position[0]) * 80000, (road.coords[0][1] - item.position[1]) * 111000);
      return score < best.score ? { score, id: road.id } : best;
    }, { score: Infinity, id: "" }) : null;
    const venue = nearest ? edges.find(edge => edge.id === nearest.id)?.to : undefined;
    return { id: item.id, kind: item.kind, edges: selected, start: window.start, end: window.end, capacity: item.kind === "event" ? 1 : item.restriction === "full-closure" ? 0 : Math.max(0.35, 1 - 1 / Math.max(...selected.map(i => edges[i].lanes))), vehicles: item.kind === "event" ? (item.attendance ?? 1000) * 0.3 / 2 : 0, destination: venue };
  });
  const begin = Math.min(start - 20, Math.floor(Math.min(...operations.map(op => op.start - (op.kind === "event" ? 60 : 0))) / 60) * 60 - 90);
  const warmup = Math.min(360, start - begin);
  if (start - begin > 360) warnings.add("This run approximates earlier congestion with a six-hour history. Restrictions older than that may have a different accumulated backlog.");
  const dayProfiles: Record<string, number[]> = {}, dayTypes: Record<string, 0 | 1> = {};
  for (let offset = -1; offset <= 1; offset++) {
    const type = simulationDayType(shiftSimulationDate(request.date, offset));
    dayProfiles[offset] = data.profiles[type];
    dayTypes[offset] = type === "weekday" ? 0 : 1;
  }
  return { edges, nodeCount: nodes.size, profile: data.profiles[day], dayProfiles, dayTypes, start, end, warmup, step: 5, interval: 1, operations, warnings: [...warnings] };
}
