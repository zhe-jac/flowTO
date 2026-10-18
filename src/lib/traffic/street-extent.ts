import { MAX_EXTENT_METRES, MAX_EXTENT_SECTIONS, pointOnRoad, roadDistance, roadLength, type RoadSection } from "../road-extent";
import { nearestRoad } from "../closure-placement";
import type { Road } from "../types";
import { familyLabel, nameScore, streetFamily, streetName } from "./street-names";
import { travelDirection as compassDirection } from "./model";
import type { TravelDirection } from "./road-travel";

type Edge = { road: Road; to: number; from: number; end: number; length: number };
type Junction = { point: number[]; names: Set<string> };
export type StreetExtent = { sections: RoadSection[]; roadName: string; fromStreet: string; toStreet: string; travelDirection?: TravelDirection };
export type StreetChoice = { label: string; description: string; extents: StreetExtent[] };
export class StreetExtentError extends Error {
  constructor(message: string, public code: "ambiguous" | "outside_coverage" | "not_found" | "disconnected" | "limit" | "direction" = "not_found", public choices: StreetChoice[] = []) { super(message); }
}
type Options = { knownNames?: string[]; landmarks?: { name: string; position: readonly [number, number] }[] };
const legalFlow = (road: Road) => /against/i.test(road.properties.direction) ? -1 : /follow/i.test(road.properties.direction) ? 1 : 0;

export function createStreetExtentResolver(roads: Road[], options: Options = {}) {
  const byId = new Map(roads.map(road => [road.properties.id, road]));
  const names = [...new Set(roads.map(road => road.properties.name))].filter(Boolean).sort();
  const normalized = new Map(names.map(name => [name, streetName(name)]));
  const junctions: Junction[] = [], endpoints = new Map<string, [number, number]>(), cells = new Map<string, number[]>();
  const junction = (point: number[]) => {
    const x = Math.floor(point[0] * 80400 / 2), y = Math.floor(point[1] * 111200 / 2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const id of cells.get(`${x + dx},${y + dy}`) ?? []) if (roadDistance(point, junctions[id].point) <= 2) return id;
    const id = junctions.length;
    junctions.push({ point, names: new Set() });
    const key = `${x},${y}`, ids = cells.get(key) ?? [];
    ids.push(id); cells.set(key, ids);
    return id;
  };
  for (const road of roads) {
    if (road.geometry.coordinates.length < 2) continue;
    const a = junction(road.geometry.coordinates[0]), b = junction(road.geometry.coordinates.at(-1)!);
    junctions[a].names.add(road.properties.name); junctions[b].names.add(road.properties.name);
    endpoints.set(road.properties.id, [a, b]);
  }
  const matching = (value: string) => {
    if (typeof value !== "string" || !value.trim() || value.length > 120) throw new StreetExtentError("Please name the road and both cross-streets or supported landmarks.");
    const query = streetName(value);
    return names.map(name => ({ name, score: nameScore(query, normalized.get(name)!) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  };
  const missing = (value: string): never => {
    if (options.knownNames?.some(name => nameScore(streetName(value), streetName(name)) === 100)) throw new StreetExtentError(`“${value}” exists in the city data but is outside the supported downtown placement area. Choose a location within that area.`, "outside_coverage");
    throw new StreetExtentError(`I could not find “${value}” in the supported streets or landmarks. Check its spelling or name a nearby cross-street.`, "not_found");
  };
  const pointAt = (extent: StreetExtent, last: boolean) => {
    const section = last ? extent.sections.at(-1)! : extent.sections[0];
    return pointOnRoad(byId.get(section.roadId)!, last ? section.to : section.from);
  };
  const allowed = (extent: StreetExtent): TravelDirection[] => {
    const heading = compassDirection(pointAt(extent, false), pointAt(extent, true)).toLowerCase() as TravelDirection;
    const opposite: Record<string, TravelDirection> = { eastbound: "westbound", westbound: "eastbound", northbound: "southbound", southbound: "northbound" };
    const forward = extent.sections.every(s => !legalFlow(byId.get(s.roadId)!) || legalFlow(byId.get(s.roadId)!) === (s.to > s.from ? 1 : -1));
    const reverse = extent.sections.every(s => !legalFlow(byId.get(s.roadId)!) || legalFlow(byId.get(s.roadId)!) === (s.to > s.from ? -1 : 1));
    return [...(forward ? [heading] : []), ...(reverse ? [opposite[heading]] : [])];
  };
  const label = (extent: StreetExtent) => {
    const movements = allowed(extent);
    const roadNames = [...new Set(extent.sections.map(s => byId.get(s.roadId)!.properties.name))];
    const expressway = extent.sections.every(s => byId.get(s.roadId)!.properties.roadClass === "Expressway");
    return expressway ? `${familyLabel(streetName(roadNames[0]))} · ${movements.length === 1 ? movements[0] : "both directions"}` : roadNames.join(" / ");
  };
  let limitedSearch = false;
  const findPaths = (roadNames: Set<string>, from: string, to: string): StreetExtent[] => {
    const selected = roads.filter(road => roadNames.has(road.properties.name));
    let nextNode = junctions.length;
    const splits = new Map<string, { fraction: number; node: number }[]>();
    const boundary = (value: string) => {
      const found = matching(value);
      if (found.length) {
        const candidates = new Set(found.filter(item => item.score >= found[0].score - 10).map(item => item.name));
        const nodes = junctions.flatMap((j, i) => [...j.names].some(name => candidates.has(name)) && [...j.names].some(name => roadNames.has(name)) ? [i] : []);
        const touchingNames = [...new Set(nodes.flatMap(node => [...junctions[node].names].filter(name => candidates.has(name))))];
        return { nodes, label: touchingNames.length ? touchingNames.join(" / ") : found[0].name };
      }
      const query = streetName(value);
      const landmark = options.landmarks?.filter(place => nameScore(query, streetName(place.name)) >= 70);
      if (!landmark?.length) return missing(value);
      if (landmark.length > 1) throw new StreetExtentError(`Several landmarks match “${value}”. Please use its full name.`, "ambiguous");
      const p = landmark[0].position;
      const project = (coordinate: [number, number]) => ({ x: coordinate[0] * Math.cos(p[1] * Math.PI / 180) * 111200, y: coordinate[1] * 111200 });
      const snap = nearestRoad(selected, project([p[0], p[1]]), project, 250);
      if (!snap) throw new StreetExtentError(`${landmark[0].name} is not within 250 m of the selected road. Name a closer cross-street or landmark.`, "disconnected");
      const pair = endpoints.get(snap.road.properties.id)!;
      const id = snap.fraction < 0.00001 ? pair[0] : snap.fraction > 0.99999 ? pair[1] : nextNode++;
      const list = splits.get(snap.road.properties.id) ?? [];
      list.push({ fraction: snap.fraction, node: id }); splits.set(snap.road.properties.id, list);
      return { nodes: [id], label: `near ${landmark[0].name}` };
    };
    const start = boundary(from), end = boundary(to);
    if (!start.nodes.length || !end.nodes.length) return [];
    const graph = new Map<number, Edge[]>();
    const add = (at: number, edge: Edge) => { const list = graph.get(at) ?? []; list.push(edge); graph.set(at, list); };
    for (const road of selected) {
      const pair = endpoints.get(road.properties.id);
      if (!pair) continue;
      const points = [{ fraction: 0, node: pair[0] }, ...(splits.get(road.properties.id) ?? []), { fraction: 1, node: pair[1] }].sort((a, b) => a.fraction - b.fraction);
      const length = roadLength(road.geometry.coordinates);
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        if (a.node === b.node || b.fraction - a.fraction < 0.00001) continue;
        add(a.node, { road, to: b.node, from: a.fraction, end: b.fraction, length: length * (b.fraction - a.fraction) });
        add(b.node, { road, to: a.node, from: b.fraction, end: a.fraction, length: length * (b.fraction - a.fraction) });
      }
    }
    const ends = new Set(end.nodes), results: StreetExtent[] = [];
    let visits = 0;
    const walk = (at: number, sections: RoadSection[], seen: Set<number>, length: number) => {
      if (results.length >= 6 || visits++ > 20000) return;
      if (ends.has(at) && sections.length) {
        results.push({ sections, roadName: [...new Set(sections.map(s => byId.get(s.roadId)!.properties.name))].join(" / "), fromStreet: start.label, toStreet: end.label });
        return;
      }
      if (sections.length >= MAX_EXTENT_SECTIONS) { limitedSearch = true; return; }
      for (const edge of graph.get(at) ?? []) if (!seen.has(edge.to)) {
        if (length + edge.length > MAX_EXTENT_METRES) { limitedSearch = true; continue; }
        walk(edge.to, [...sections, { roadId: edge.road.properties.id, from: edge.from, to: edge.end }], new Set([...seen, edge.to]), length + edge.length);
      }
    };
    for (const at of start.nodes) walk(at, [], new Set([at]), 0);
    if (visits > 20000) throw new StreetExtentError("This street has too many matching branches. Please choose closer cross-streets.", "ambiguous");
    return results.filter((extent, i, all) => all.findIndex(other => JSON.stringify(other.sections) === JSON.stringify(extent.sections)) === i);
  };
  const collect = (road: string, from: string, to: string) => {
    const found = matching(road);
    if (!found.length) return missing(road);
    if (streetName(from).base === streetName(to).base) throw new StreetExtentError("Please specify two different cross-streets or landmarks.");
    if ([from, to].some(cross => nameScore(streetName(cross), streetName(road)) === 100)) throw new StreetExtentError("Please specify two cross-streets that differ from the road being closed.");
    const groups = new Map<string, { names: Set<string>; score: number }>();
    for (const match of found.filter(item => item.score >= found[0].score - 15)) {
      const key = streetFamily(normalized.get(match.name)!);
      const group = groups.get(key) ?? { names: new Set(), score: match.score };
      group.names.add(match.name); groups.set(key, group);
    }
    return [...groups.values()].flatMap(group => findPaths(group.names, from, to).map(extent => ({ extent, score: group.score })));
  };
  const choicesFor = (extents: StreetExtent[]): StreetChoice[] => extents.slice(0, 4).map(extent => ({ label: label(extent), description: `${extent.fromStreet} → ${extent.toStreet} · ${Math.round(extent.sections.reduce((sum, s) => sum + roadLength(byId.get(s.roadId)!.geometry.coordinates) * Math.abs(s.to - s.from), 0))} m`, extents: [extent] }));
  const resolveLocation = (road: string, from: string, to: string, direction: TravelDirection = "both") => {
    for (const value of [road, from, to]) if (typeof value !== "string" || !value.trim() || value.length > 120) throw new StreetExtentError("Please name the road and both cross-streets or supported landmarks.");
    limitedSearch = false;
    const directed = (extents: StreetExtent[]) => extents.filter(extent => direction === "both" || allowed(extent).includes(direction)).map(extent => ({ ...extent, travelDirection: allowed(extent).length === 1 ? allowed(extent)[0] : direction }));
    let candidates = collect(road, from, to);
    if (!candidates.length) {
      const parsed = streetName(road);
      if (parsed.suffix) {
        const broad = `${parsed.base} ${parsed.type}`;
        const broader = collect(broad, from, to).map(c => c.extent);
        const alternatives = directed(broader);
        if (broader.length && !alternatives.length) throw new StreetExtentError(`The matched stretch does not support ${direction} travel. Check the requested travel direction.`, "direction");
        if (alternatives.length) throw new StreetExtentError(`Those limits match ${alternatives.map(label).join(" or ")}, rather than only the named street section. Choose the intended stretch.`, "ambiguous", choicesFor(alternatives));
      }
      throw new StreetExtentError(limitedSearch ? `This stretch exceeds the supported 3 km or ${MAX_EXTENT_SECTIONS} segments. Choose closer cross-streets.` : `I found ${road}, but its supported geometry does not connect ${from} to ${to}. Check the cross-streets or choose a shorter stretch.`, limitedSearch ? "limit" : "disconnected");
    }
    if (direction !== "both") candidates = candidates.filter(candidate => allowed(candidate.extent).includes(direction));
    if (!candidates.length) throw new StreetExtentError(`The matched stretch does not support ${direction} travel. Check the requested travel direction.`, "direction");
    const best = candidates[0].score;
    const extents = directed(candidates.filter(c => c.score >= best - 10).map(c => c.extent));
    if (extents.length === 1) return extents;
    if (extents.length === 2 && direction === "both") {
      const a = allowed(extents[0]), b = allowed(extents[1]);
      const gap = (roadDistance(pointAt(extents[0], false), pointAt(extents[1], false)) + roadDistance(pointAt(extents[0], true), pointAt(extents[1], true))) / 2;
      const sameRoad = streetFamily(streetName(extents[0].roadName)) === streetFamily(streetName(extents[1].roadName));
      const opposite: Record<string, string> = { eastbound: "westbound", westbound: "eastbound", northbound: "southbound", southbound: "northbound" };
      if (sameRoad && gap < 100 && a.length === 1 && b.length === 1 && opposite[a[0]] === b[0]) return extents;
    }
    throw new StreetExtentError(`More than one stretch matches ${road} between ${from} and ${to}. Choose a highlighted option.`, "ambiguous", choicesFor(extents));
  };
  return {
    names, roads: byId, resolveLocation,
    resolve(road: string, from: string, to: string): StreetExtent {
      const extents = resolveLocation(road, from, to);
      if (extents.length > 1) throw new StreetExtentError(`More than one stretch matches ${road}. Choose a travel direction or request both directions.`, "ambiguous", choicesFor(extents));
      return extents[0];
    },
    candidates(text: string, reference?: readonly [number, number]) {
      const query = ` ${streetName(text.replace(/\b(?:close|block|add|place|construct|both|ways|from|between|to)\b/gi, " ")).base} `;
      const ranked = roads.map(road => {
        const name = normalized.get(road.properties.name)!;
        const phrase = query.includes(` ${name.base} `);
        const significant = name.base.split(" ").filter(w => w.length >= 4 && !["ramp", "street", "avenue"].includes(w));
        const overlap = significant.filter(word => query.split(" ").some(token => nameScore({ base: word, type: "", suffix: "", ramp: false }, { base: token, type: "", suffix: "", ramp: false }) > 0)).length;
        const distance = reference ? roadDistance([...reference], road.geometry.coordinates[0]) : 0;
        return { road, score: (phrase ? 100 : 0) + overlap * 10 - (name.ramp && !/\bramp\b/i.test(text) ? 60 : 0) - Math.min(5, distance / 1000) };
      }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score || a.road.properties.id.localeCompare(b.road.properties.id));
      const counts = new Map<string, number>();
      return ranked.filter(({ road }) => { const count = counts.get(road.properties.name) ?? 0; counts.set(road.properties.name, count + 1); return count < 12; }).slice(0, 100).map(c => c.road);
    },
  };
}
export type StreetExtentResolver = ReturnType<typeof createStreetExtentResolver>;
