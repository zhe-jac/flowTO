import type { Coordinate } from "./city-boundary";
import type { RoadDisruption } from "./disruptions";
import type { Road } from "./types";

export type RoadAnchor = { roadId: string; fraction: number };
export type RoadSection = { roadId: string; from: number; to: number };
export const MAX_EXTENT_SECTIONS = 24;
export const MIN_EXTENT_METRES = 5;
export const MAX_EXTENT_METRES = 3000;
const coordinate = (point: number[]): Coordinate => [point[0], point[1]];

export function roadDistance(a: number[], b: number[]) {
  const latitude = (a[1] + b[1]) * Math.PI / 360;
  return Math.hypot((b[0] - a[0]) * 111200 * Math.cos(latitude), (b[1] - a[1]) * 111200);
}

export function roadLength(points: number[][]) {
  return points.slice(1).reduce((total, point, index) => total + roadDistance(points[index], point), 0);
}

export function pointOnRoad(road: Pick<Road, "geometry">, fraction: number): Coordinate {
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

export function validRoadExtent(item: RoadDisruption, coordinates: (id: string) => number[][] | undefined) {
  if (!item.roadSections) return !!coordinates(item.roadId);
  let previous: Coordinate | null = null;
  let length = 0;
  for (const section of item.roadSections) {
    const points = coordinates(section.roadId);
    if (!points || points.length < 2) return false;
    const road = { geometry: { type: "LineString" as const, coordinates: points } };
    const start = pointOnRoad(road, section.from);
    if (previous && roadDistance(previous, start) > 2) return false;
    previous = pointOnRoad(road, section.to);
    length += roadLength(points) * Math.abs(section.to - section.from);
  }
  return length >= MIN_EXTENT_METRES && length <= MAX_EXTENT_METRES;
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

export function traceRoadExtent(sections: RoadSection[], target: RoadAnchor, endpoint: number, roads: ReadonlyMap<string, Road>): RoadSection[] | null {
  if (!sections.length || !Number.isFinite(target.fraction) || target.fraction < 0 || target.fraction > 1) return null;
  const road = roads.get(target.roadId);
  if (!road) return null;
  const reversed = endpoint === 0;
  const path = reversed ? [...sections].reverse().map(section => ({ roadId: section.roadId, from: section.to, to: section.from })) : sections.map(section => ({ ...section }));
  const existing = path.findIndex(section => section.roadId === target.roadId);
  let next: RoadSection[];
  if (existing >= 0) {
    next = path.slice(0, existing + 1);
    next[existing] = { ...next[existing], to: target.fraction };
    if (next[existing].from === next[existing].to) next.pop();
  } else {
    const last = path.at(-1)!;
    const previousRoad = roads.get(last.roadId);
    if (!previousRoad) return null;
    const exit = last.to > last.from ? 1 : 0;
    const atIntersection = last.to === 0 || last.to === 1;
    const fromIntersection = last.from === 0 || last.from === 1;
    const entryPosition = pointOnRoad(previousRoad, last.from);
    const branchJoins = !atIntersection && fromIntersection ? [0, 1].filter(fraction => roadDistance(entryPosition, pointOnRoad(road, fraction)) <= 2) : [];
    const exitPosition = pointOnRoad(previousRoad, exit);
    const joins = branchJoins.length ? branchJoins : [0, 1].filter(fraction => roadDistance(exitPosition, pointOnRoad(road, fraction)) <= 2);
    if (!joins.length) return null;
    const entry = joins.sort((a, b) => Math.abs(target.fraction - a) - Math.abs(target.fraction - b))[0];
    next = path.slice(0, -1);
    if (!branchJoins.length && last.from !== exit) next.push({ ...last, to: exit });
    if (entry !== target.fraction) next.push({ roadId: target.roadId, from: entry, to: target.fraction });
  }
  if (!next.length || next.length > MAX_EXTENT_SECTIONS) return null;
  let length = 0;
  for (const section of next) {
    const selectedRoad = roads.get(section.roadId);
    if (!selectedRoad) return null;
    length += roadLength(selectedRoad.geometry.coordinates) * Math.abs(section.to - section.from);
  }
  if (length < MIN_EXTENT_METRES || length > MAX_EXTENT_METRES) return null;
  return reversed ? [...next].reverse().map(section => ({ roadId: section.roadId, from: section.to, to: section.from })) : next;
}
