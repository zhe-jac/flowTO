import type { Coordinate } from "./city-boundary";
import type { RoadDisruption } from "./disruptions";
import type { Road } from "./types";

export type RoadAnchor = { roadId: string; fraction: number };
export type RoadSection = { roadId: string; from: number; to: number };
export const MAX_EXTENT_SECTIONS = 24;
export const MIN_EXTENT_METRES = 5;
const MAX_EXTENT_METRES = 3000;
const key = (point: number[]) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
const coordinate = (point: number[]): Coordinate => [point[0], point[1]];

export function roadDistance(a: number[], b: number[]) {
  const latitude = (a[1] + b[1]) * Math.PI / 360;
  return Math.hypot((b[0] - a[0]) * 111200 * Math.cos(latitude), (b[1] - a[1]) * 111200);
}

export function roadLength(points: number[][]) {
  return points.slice(1).reduce((total, point, index) => total + roadDistance(points[index], point), 0);
}


export function pointOnRoad(road: Road, fraction: number): Coordinate {
  const points = road.geometry.coordinates;
  const target = Math.max(0, Math.min(1, fraction)) * roadLength(points);
  let travelled = 0;
  for (let index = 1; index < points.length; index++) {
    const length = roadDistance(points[index - 1], points[index]);
    if (travelled + length >= target && length > 0) {
      const t = (target - travelled) / length;
      return [points[index - 1][0] + t * (points[index][0] - points[index - 1][0]), points[index - 1][1] + t * (points[index][1] - points[index - 1][1])];
    }
    travelled += length;
  }
  return coordinate(points.at(-1)!);
}

export function sectionCoordinates(road: Road, from: number, to: number): Coordinate[] {
  const low = Math.min(from, to), high = Math.max(from, to);
  const points = road.geometry.coordinates;
  const length = roadLength(points);
  const result = [pointOnRoad(road, low)];
  let travelled = 0;
  for (let index = 1; index < points.length - 1; index++) {
    travelled += roadDistance(points[index - 1], points[index]);
    if (travelled > low * length && travelled < high * length) result.push(coordinate(points[index]));
  }
  result.push(pointOnRoad(road, high));
  return from > to ? result.reverse() : result;
}

export function roadSections(item: RoadDisruption): RoadSection[] {
  return item.roadSections ?? [{ roadId: item.roadId, from: 0, to: 1 }];
}

export function affectedRoadIds(item: RoadDisruption): string[] {
  return [...new Set(roadSections(item).map(section => section.roadId))];
}

export function extentDetails(item: RoadDisruption, roads: ReadonlyMap<string, Road>) {
  const sections = roadSections(item);
  const names = new Set<string>();
  let lengthM = 0;
  for (const section of sections) {
    const road = roads.get(section.roadId);
    if (!road) continue;
    names.add(road.properties.name);
    lengthM += roadLength(road.geometry.coordinates) * Math.abs(section.to - section.from);
  }
  return { lengthM, segmentCount: sections.length, names: [...names] };
}

export function extentAnchors(item: RoadDisruption): [RoadAnchor, RoadAnchor] {
  const sections = roadSections(item);
  return [{ roadId: sections[0].roadId, fraction: sections[0].from }, { roadId: sections.at(-1)!.roadId, fraction: sections.at(-1)!.to }];
}

export function applyRoadSections(item: RoadDisruption, sections: RoadSection[], roads: ReadonlyMap<string, Road>): RoadDisruption {
  const lengths = sections.map(section => roadLength(roads.get(section.roadId)!.geometry.coordinates) * Math.abs(section.to - section.from));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
  for (let index = 0; index < sections.length; index++) {
    if (remaining <= lengths[index] || index === sections.length - 1) {
      const section = sections[index];
      const fraction = section.from + (section.to - section.from) * (lengths[index] ? remaining / lengths[index] : 0);
      return { ...item, roadId: section.roadId, position: pointOnRoad(roads.get(section.roadId)!, fraction), roadSections: sections };
    }
    remaining -= lengths[index];
  }
  return item;
}

export function createRoadExtentNetwork(roads: ReadonlyMap<string, Road>) {
  type Edge = { node: string; section: RoadSection; length: number };
  const graph = new Map<string, Edge[]>();
  const lengths = new Map<string, number>();
  const add = (from: string, edge: Edge) => {
    const edges = graph.get(from) ?? [];
    edges.push(edge);
    graph.set(from, edges);
  };
  for (const road of roads.values()) {
    const points = road.geometry.coordinates;
    const id = road.properties.id;
    const length = roadLength(points);
    if (!length) continue;
    lengths.set(id, length);
    add(key(points[0]), { node: key(points.at(-1)!), section: { roadId: id, from: 0, to: 1 }, length });
    add(key(points.at(-1)!), { node: key(points[0]), section: { roadId: id, from: 1, to: 0 }, length });
  }

  return (start: RoadAnchor, end: RoadAnchor): RoadSection[] | null => {
    const first = roads.get(start.roadId), last = roads.get(end.roadId);
    if (!first || !last || !lengths.has(start.roadId) || !lengths.has(end.roadId)) return null;
    if (start.roadId === end.roadId) {
      return Math.abs(start.fraction - end.fraction) * lengths.get(start.roadId)! >= MIN_EXTENT_METRES ? [{ roadId: start.roadId, from: start.fraction, to: end.fraction }] : null;
    }
    type Entry = { node: string; distance: number; sections: RoadSection[] };
    const queue: Entry[] = [];
    const push = (entry: Entry) => {
      queue.push(entry);
      let index = queue.length - 1;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (queue[parent].distance <= entry.distance) break;
        queue[index] = queue[parent];
        index = parent;
      }
      queue[index] = entry;
    };
    const pop = () => {
      const entry = queue[0];
      const tail = queue.pop()!;
      if (queue.length) {
        let index = 0;
        while (index * 2 + 1 < queue.length) {
          let child = index * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1].distance < queue[child].distance) child++;
          if (queue[child].distance >= tail.distance) break;
          queue[index] = queue[child];
          index = child;
        }
        queue[index] = tail;
      }
      return entry;
    };
    const distances = new Map<string, number>();
    for (const fraction of [0, 1]) {
      const node = key(first.geometry.coordinates[fraction ? first.geometry.coordinates.length - 1 : 0]);
      const distance = Math.abs(start.fraction - fraction) * lengths.get(start.roadId)!;
      if (distance >= (distances.get(node) ?? Infinity)) continue;
      distances.set(node, distance);
      push({ node, distance, sections: distance > 0.01 ? [{ roadId: start.roadId, from: start.fraction, to: fraction }] : [] });
    }
    const ends = [key(last.geometry.coordinates[0]), key(last.geometry.coordinates.at(-1)!)];
    let best: { distance: number; sections: RoadSection[] } | null = null;
    let visited = 0;
    while (queue.length && visited++ < 2500) {
      const current = pop();
      if (current.distance !== distances.get(current.node) || current.distance > MAX_EXTENT_METRES || current.distance >= (best?.distance ?? Infinity)) continue;
      for (let fraction = 0; fraction <= 1; fraction++) {
        if (current.node !== ends[fraction]) continue;
        const extra = Math.abs(end.fraction - fraction) * lengths.get(end.roadId)!;
        const distance = current.distance + extra;
        const sections = extra > 0.01 ? [...current.sections, { roadId: end.roadId, from: fraction, to: end.fraction }] : current.sections;
        if (distance >= MIN_EXTENT_METRES && distance <= MAX_EXTENT_METRES && sections.length <= MAX_EXTENT_SECTIONS && distance < (best?.distance ?? Infinity)) best = { distance, sections };
      }
      if (current.sections.length >= MAX_EXTENT_SECTIONS - 1) continue;
      for (const edge of graph.get(current.node) ?? []) {
        if (edge.section.roadId === start.roadId || edge.section.roadId === end.roadId) continue;
        const distance = current.distance + edge.length;
        if (distance >= (distances.get(edge.node) ?? Infinity) || distance > MAX_EXTENT_METRES) continue;
        distances.set(edge.node, distance);
        push({ node: edge.node, distance, sections: [...current.sections, edge.section] });
      }
    }
    return best?.sections ?? null;
  };
}

export type RoadExtentNetwork = ReturnType<typeof createRoadExtentNetwork>;
