import type { RoadDisruption } from "../disruptions";
import { pointOnRoad, roadSections } from "../road-extent";
export const TRAVEL_DIRECTIONS = ["both", "eastbound", "westbound", "northbound", "southbound"] as const;
export type TravelDirection = typeof TRAVEL_DIRECTIONS[number];
export function requestedTravelDirection(text: string): TravelDirection | undefined {
  const directions = [...text.toLowerCase().matchAll(/\b(east|west|north|south)[\s-]*bound\b/g)].map(match => `${match[1]}bound` as TravelDirection);
  if (/\bboth\s+(?:ways|directions)\b|\bin\s+each\s+direction\b/i.test(text) || new Set(directions).size > 1) return "both";
  return directions[0];
}
export function roadTravelDirections(item: RoadDisruption, coordinates: (id: string) => number[][] | undefined): Map<string, 1 | -1> | null {
  if (!item.travelDirection || item.travelDirection === "both") return null;
  const sections = roadSections(item), first = sections[0], last = sections.at(-1)!;
  const a = coordinates(first.roadId), b = coordinates(last.roadId);
  if (!a || !b) return new Map();
  const start = pointOnRoad({ geometry: { type: "LineString", coordinates: a } }, first.from);
  const end = pointOnRoad({ geometry: { type: "LineString", coordinates: b } }, last.to);
  const horizontal = item.travelDirection === "eastbound" || item.travelDirection === "westbound";
  const delta = horizontal ? end[0] - start[0] : end[1] - start[1];
  const positive = item.travelDirection === "eastbound" || item.travelDirection === "northbound";
  if (Math.abs(delta) < 1e-8) return new Map();
  const along = (delta > 0) === positive ? 1 : -1;
  return new Map(sections.map(section => [section.roadId, ((section.to > section.from ? 1 : -1) * along) as 1 | -1]));
}
