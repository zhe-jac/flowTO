import { MAX_EXTENT_METRES, MAX_EXTENT_SECTIONS, roadDistance, roadLength, type RoadSection } from "../road-extent";
import type { Road } from "../types";

type StreetName = { base: string; type: string; direction: string };
type Edge = { road: Road; to: number; from: number; end: number; length: number };
type Junction = { point: number[]; names: Set<string>; edges: Edge[] };
export type StreetExtent = { sections: RoadSection[]; roadName: string; fromStreet: string; toStreet: string };
export class StreetExtentError extends Error {}

const abbreviations: Record<string, string> = { street: "st", avenue: "ave", road: "rd", boulevard: "blvd", drive: "dr", crescent: "cres", court: "crt", place: "pl", terrace: "ter", lane: "ln", parkway: "pkwy", highway: "hwy", north: "n", south: "s", east: "e", west: "w" };
const types = new Set(["st", "ave", "rd", "blvd", "dr", "cres", "crt", "pl", "ter", "ln", "pkwy", "hwy"]);
function streetName(value: string): StreetName {
  const words = value.normalize("NFKD").replace(/[\u0300-\u036f'’]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).map(word => abbreviations[word] ?? word);
  const direction = ["n", "s", "e", "w"].includes(words.at(-1)!) ? words.pop()! : "";
  const type = types.has(words.at(-1)!) ? words.pop()! : "";
  return { base: words.join(" "), type, direction };
}
function matches(query: StreetName, name: StreetName) {
  return query.base === name.base && (!query.type || query.type === name.type) && (!query.direction || query.direction === name.direction);
}

export function createStreetExtentResolver(roads: Road[]) {
  const byId = new Map(roads.map(road => [road.properties.id, road]));
  const names = [...new Set(roads.map(road => road.properties.name))].filter(Boolean).sort();
  const normalized = new Map(names.map(name => [name, streetName(name)]));
  const junctions: Junction[] = [];
  const cells = new Map<string, number[]>();
  const junction = (point: number[]) => {
    const x = Math.floor(point[0] * 80400 / 2), y = Math.floor(point[1] * 111200 / 2);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const id of cells.get(`${x + dx},${y + dy}`) ?? []) if (roadDistance(point, junctions[id].point) <= 2) return id;
    }
    const id = junctions.length;
    junctions.push({ point, names: new Set(), edges: [] });
    const key = `${x},${y}`;
    const ids = cells.get(key) ?? [];
    ids.push(id); cells.set(key, ids);
    return id;
  };
  for (const road of roads) {
    if (road.geometry.coordinates.length < 2) continue;
    const a = junction(road.geometry.coordinates[0]), b = junction(road.geometry.coordinates.at(-1)!);
    const length = roadLength(road.geometry.coordinates);
    junctions[a].names.add(road.properties.name); junctions[b].names.add(road.properties.name);
    junctions[a].edges.push({ road, to: b, from: 0, end: 1, length });
    junctions[b].edges.push({ road, to: a, from: 1, end: 0, length });
  }
  const findNames = (value: string) => {
    if (typeof value !== "string" || !value.trim() || value.length > 120) throw new StreetExtentError("Please name the road and both cross-streets, for example Queen Street West from Spadina Avenue to University Avenue.");
    const query = streetName(value);
    const found = names.filter(name => matches(query, normalized.get(name)!));
    if (!found.length) throw new StreetExtentError(`I could not find “${value.trim()}” in the supported downtown streets. Please check the name or choose a street inside the toolbox coverage area.`);
    return new Set(found);
  };
  return {
    names,
    roads: byId,
    resolve(road: string, from: string, to: string): StreetExtent {
      const roadNames = findNames(road), fromNames = findNames(from), toNames = findNames(to);
      if ([...roadNames].some(name => fromNames.has(name) || toNames.has(name)) || [...fromNames].some(name => toNames.has(name))) throw new StreetExtentError("Please specify two different cross-streets that intersect the road being closed.");
      const touching = (junction: Junction, choices: Set<string>) => [...junction.names].some(name => choices.has(name));
      const starts = junctions.flatMap((node, index) => touching(node, roadNames) && touching(node, fromNames) ? [index] : []);
      const ends = new Set(junctions.flatMap((node, index) => touching(node, roadNames) && touching(node, toNames) ? [index] : []));
      if (!starts.length || !ends.size) throw new StreetExtentError(`I could not find connected intersections of ${road} with both ${from} and ${to} in downtown coverage. Please check the cross-streets or specify a shorter stretch.`);
      const results: StreetExtent[] = [];
      let visited = 0;
      const walk = (at: number, start: number, sections: RoadSection[], seen: Set<number>, length: number) => {
        if (results.length > 1 || visited++ > 10000) return;
        if (ends.has(at) && sections.length) {
          const selected = sections.map(section => byId.get(section.roadId)!.properties.name);
          results.push({ sections, roadName: [...new Set(selected)].join(" / "), fromStreet: [...junctions[start].names].find(name => fromNames.has(name))!, toStreet: [...junctions[at].names].find(name => toNames.has(name))! });
          return;
        }
        if (sections.length >= MAX_EXTENT_SECTIONS) return;
        for (const edge of junctions[at].edges) {
          if (!roadNames.has(edge.road.properties.name) || seen.has(edge.to) || length + edge.length > MAX_EXTENT_METRES) continue;
          walk(edge.to, start, [...sections, { roadId: edge.road.properties.id, from: edge.from, to: edge.end }], new Set([...seen, edge.to]), length + edge.length);
        }
      };
      for (const start of starts) walk(start, start, [], new Set([start]), 0);
      if (results.length > 1 || visited > 10000) throw new StreetExtentError(`More than one stretch matches ${road} between ${from} and ${to}. Please include the street direction or more specific cross-streets.`);
      if (!results.length) throw new StreetExtentError(`There is no supported continuous stretch along ${road} between those intersections within 3 km and ${MAX_EXTENT_SECTIONS} segments. Please choose closer cross-streets; I will not reroute the closure onto other roads.`);
      return results[0];
    },
  };
}
export type StreetExtentResolver = ReturnType<typeof createStreetExtentResolver>;
