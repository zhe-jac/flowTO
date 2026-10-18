import type { Impact } from "./rerouting";
import { applyRoadSections, validRoadExtent } from "../road-extent";
import { StreetExtentError, type StreetExtentResolver } from "./street-extent";
import { validateDisruption, type Disruption } from "../disruptions";
import { shiftSimulationDate, validSimulationDate } from "./simulation-date";
import type { TrafficSegment } from "./types";
import { VENUES } from "./activity";

export type ChatAction = { kind: string; title: string; roadId?: string; roadName?: string; fromStreet?: string; toStreet?: string; restriction?: "full-closure" | "lane-reduction"; venueId?: string; attendance?: number; startMinutes: number; durationMinutes: number };
export type ChatProposal = Disruption & { locationLabel?: string };
export function chatDisruptions(actions: unknown, roads: TrafficSegment[], date: string, streets?: StreetExtentResolver): ChatProposal[] {
  if (!validSimulationDate(date) || !Array.isArray(actions) || actions.length > 5) throw new Error("Invalid scenario proposal");
  return actions.map((action: ChatAction) => {
    if (!action || !["event", "closure", "construction", "accident"].includes(action.kind) || typeof action.title !== "string" || !Number.isInteger(action.startMinutes) || action.startMinutes < 0 || action.startMinutes >= 1440 || !Number.isInteger(action.durationMinutes) || action.durationMinutes < 1 || action.durationMinutes > 1440) throw new Error("Invalid event or time");
    const stamp = (minutes: number) => `${shiftSimulationDate(date, Math.floor(minutes / 1440))}T${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const base = { id: crypto.randomUUID(), title: action.title, startsAt: stamp(action.startMinutes), endsAt: stamp(action.startMinutes + action.durationMinutes), timeZone: "America/Toronto" as const };
    let item: Disruption;
    let locationLabel: string | undefined;
    if (action.kind === "event") {
      const venue = VENUES.find(v => v.id === action.venueId);
      if (!venue || !Number.isInteger(action.attendance) || action.attendance! < 0 || action.attendance! > venue.capacity) throw new Error("Choose a supported venue and attendance within its capacity");
      item = { ...base, kind: "event", position: venue.position, attendance: action.attendance! };
    } else {
      const restriction = action.restriction ?? (action.kind === "closure" ? "full-closure" : "lane-reduction");
      if (!["full-closure", "lane-reduction"].includes(restriction)) throw new Error("Invalid road restriction");
      if (action.roadName || action.fromStreet || action.toStreet) {
        if (!streets) throw new StreetExtentError("Street matching is unavailable. Please try again or use the manual map tools.");
        const extent = streets.resolve(action.roadName!, action.fromStreet!, action.toStreet!);
        const road = streets.roads.get(extent.sections[0].roadId)!;
        item = applyRoadSections({ ...base, kind: action.kind as "closure" | "construction" | "accident", position: [road.geometry.coordinates[0][0], road.geometry.coordinates[0][1]], roadId: road.properties.id, restriction }, extent.sections, streets.roads);
        if (!validRoadExtent(item, id => streets.roads.get(id)?.geometry.coordinates)) throw new StreetExtentError("Those streets do not form a continuous supported closure. Please check the cross-streets.");
        locationLabel = `${extent.roadName}: ${extent.fromStreet} → ${extent.toStreet}`;
      } else {
        const road = roads.find(r => r.id === action.roadId);
        if (!road) throw new StreetExtentError("Please describe the road and both cross-streets, for example Queen Street West from Spadina Avenue to University Avenue.");
        const p = road.coords[Math.floor(road.coords.length / 2)];
        item = { ...base, kind: action.kind as "closure" | "construction" | "accident", position: [p[0], p[1]], roadId: road.id, restriction };
      }
    }
    const error = validateDisruption(item);
    if (error) throw new Error(error);
    return locationLabel ? { ...item, locationLabel } : item;
  });
}

export type ChatTrafficContext = {
  date: string; minutes: number; day: "weekday" | "weekend";
  source: string;
  impacts: Record<string, Impact>;
};
