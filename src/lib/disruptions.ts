import type { FeatureCollection, LineString, Point } from "geojson";
import { isPointInToronto } from "./city-boundary";
import type { Coordinate } from "./city-boundary";
import type { Road } from "./types";

export type DisruptionKind = "closure" | "event" | "accident" | "construction";
type DisruptionBase = { id: string; title: string; position: Coordinate; startsAt: string; endsAt: string; timeZone: "America/Toronto" };
export type EventDisruption = DisruptionBase & { kind: "event"; attendance: number | null };
export type RoadDisruption = DisruptionBase & { kind: "closure" | "accident" | "construction"; roadId: string; restriction: "full-closure" | "lane-reduction" };
export type Disruption = EventDisruption | RoadDisruption;
export const DISRUPTION_TOOLS = [
  { kind: "closure", label: "Road closure", hint: "Snap to a street", color: "#c75044" },
  { kind: "event", label: "Event", hint: "Place a venue", color: "#7454b6" },
  { kind: "accident", label: "Accident", hint: "Snap to a street", color: "#c03e59" },
  { kind: "construction", label: "Construction", hint: "Snap to a street", color: "#ae671b" },
] as const;

export function disruptionTool(kind: DisruptionKind) {
  return DISRUPTION_TOOLS.find((tool) => tool.kind === kind)!;
}

export function createDisruption(id: string, kind: DisruptionKind, position: Coordinate, road?: Road): Disruption | null {
  if (!isPointInToronto(position)) return null;
  const base: DisruptionBase = { id, title: disruptionTool(kind).label, position, startsAt: "", endsAt: "", timeZone: "America/Toronto" };
  if (kind === "event") return { ...base, kind, attendance: null };
  if (!road) return null;
  return { ...base, kind, roadId: road.properties.id, restriction: kind === "closure" ? "full-closure" : "lane-reduction" };
}

export function validateDisruption(item: Disruption): string | null {
  if (!item.title.trim() || item.title.length > 80) return "Give this disruption a name of up to 80 characters.";
  if (!isPointInToronto(item.position)) return "Choose a location inside Toronto.";
  if (item.kind !== "event" && !item.roadId) return "Choose a road segment for this disruption.";
  if (item.kind === "event" && item.attendance !== null && (!Number.isInteger(item.attendance) || item.attendance < 0 || item.attendance > 1000000)) return "Attendance must be a whole number between 0 and 1,000,000.";
  if (Boolean(item.startsAt) !== Boolean(item.endsAt)) return "Add both a start and end time, or leave both blank.";
  if (item.startsAt) {
    const valid = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}:00Z`)) && new Date(`${value}:00Z`).toISOString().slice(0, 16) === value;
    if (!valid(item.startsAt) || !valid(item.endsAt)) return "Choose valid start and end times.";
    if (item.endsAt <= item.startsAt) return "The end time must be after the start time.";
  }
  return null;
}

export function upsertDisruption(items: Disruption[], item: Disruption): Disruption[] {
  const next = { ...item, title: item.title.trim() };
  return items.some((current) => current.id === item.id) ? items.map((current) => current.id === item.id ? next : current) : [...items, next];
}

export function disruptionFeatures(items: Disruption[], roads: ReadonlyMap<string, Road>): FeatureCollection<LineString | Point> {
  const features: FeatureCollection<LineString | Point>["features"] = [];
  for (const item of items) {
    const properties = { itemId: item.id, kind: item.kind, color: disruptionTool(item.kind).color };
    features.push({ type: "Feature", properties: { ...properties, role: "location" }, geometry: { type: "Point", coordinates: item.position } });
    if (item.kind === "event") continue;
    const road = roads.get(item.roadId);
    if (!road) continue;
    features.push({ type: "Feature", properties: { ...properties, roadId: item.roadId, restriction: item.restriction }, geometry: road.geometry });
    for (const coordinate of [road.geometry.coordinates[0], road.geometry.coordinates.at(-1)]) {
      if (coordinate) features.push({ type: "Feature", properties: { ...properties, role: "endpoint" }, geometry: { type: "Point", coordinates: coordinate } });
    }
  }
  return { type: "FeatureCollection", features };
}
