import type { Impact } from "./rerouting";
import { applyRoadSections, validRoadExtent } from "../road-extent";
import { StreetExtentError, type StreetExtent, type StreetExtentResolver } from "./street-extent";
import { validateDisruption, type Disruption } from "../disruptions";
import { shiftSimulationDate, validSimulationDate } from "./simulation-date";
import type { TrafficSegment } from "./types";
import { VENUES } from "./activity";
import { groundLocationAction } from "./location-intent";
import { TRAVEL_DIRECTIONS, type TravelDirection } from "./road-travel";

export type ChatAction = { kind: string; title: string; roadId?: string; roadName?: string; fromStreet?: string; toStreet?: string; restriction?: "full-closure" | "lane-reduction"; travelDirection?: TravelDirection; venueId?: string; attendance?: number; startMinutes: number; durationMinutes: number };
export type ChatProposal = Disruption & { locationLabel?: string };
export type ChatLocationChoice = { label: string; description: string; proposals: ChatProposal[] };
export class ChatLocationError extends StreetExtentError {
  constructor(message: string, public locationChoices: ChatLocationChoice[]) { super(message, "ambiguous"); }
}
export function chatDisruptions(actions: unknown, roads: TrafficSegment[], date: string, streets?: StreetExtentResolver, options: { sourceText?: string; selected?: { index: number; extents: StreetExtent[] } } = {}): ChatProposal[] {
  if (!validSimulationDate(date) || !Array.isArray(actions) || actions.length > 5) throw new Error("Invalid scenario proposal");
  const proposals = actions.flatMap((raw: ChatAction, index): ChatProposal[] => {
    if (!raw || !["event", "closure", "construction", "accident"].includes(raw.kind) || typeof raw.title !== "string" || !Number.isInteger(raw.startMinutes) || raw.startMinutes < 0 || raw.startMinutes >= 1440 || !Number.isInteger(raw.durationMinutes) || raw.durationMinutes < 1 || raw.durationMinutes > 1440) throw new Error("Invalid event or time");
    const action = groundLocationAction(raw, options.sourceText ?? "", actions.slice(0, index).filter(value => value?.kind !== "event").length);
    if (action.travelDirection !== undefined && !TRAVEL_DIRECTIONS.includes(action.travelDirection)) throw new Error("Invalid travel direction");
    const stamp = (minutes: number) => `${shiftSimulationDate(date, Math.floor(minutes / 1440))}T${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const base = { id: crypto.randomUUID(), title: action.title, startsAt: stamp(action.startMinutes), endsAt: stamp(action.startMinutes + action.durationMinutes), timeZone: "America/Toronto" as const };
    const validate = (item: ChatProposal) => { const error = validateDisruption(item); if (error) throw new Error(error); return item; };
    if (action.kind === "event") {
      const venue = VENUES.find(v => v.id === action.venueId);
      if (!venue || !Number.isInteger(action.attendance) || action.attendance! < 0 || action.attendance! > venue.capacity) throw new Error("Choose a supported venue and attendance within its capacity");
      return [validate({ ...base, kind: "event", position: venue.position, attendance: action.attendance! })];
    }
    const restriction = action.restriction ?? (action.kind === "closure" ? "full-closure" : "lane-reduction");
    if (!["full-closure", "lane-reduction"].includes(restriction)) throw new Error("Invalid road restriction");
    const travelDirection = action.travelDirection ?? "both";
    if (action.roadName || action.fromStreet || action.toStreet) {
      if (!streets) throw new StreetExtentError("Street matching is unavailable. Please try again or use the manual map tools.");
      let extents: StreetExtent[];
      try {
        extents = options.selected?.index === index ? options.selected.extents : streets.resolveLocation(action.roadName!, action.fromStreet!, action.toStreet!, travelDirection);
      } catch (error) {
        if (!(error instanceof StreetExtentError) || !error.choices.length || options.selected) throw error;
        const choices = error.choices.flatMap(choice => {
          try { return [{ label: choice.label, description: choice.description, proposals: chatDisruptions(actions, roads, date, streets, { ...options, selected: { index, extents: choice.extents } }) }]; }
          catch { return []; }
        });
        if (choices.length) throw new ChatLocationError(error.message, choices);
        throw error;
      }
      const groupId = extents.length > 1 ? crypto.randomUUID() : undefined;
      return extents.map(extent => {
        const movement = extent.travelDirection ?? travelDirection;
        const road = streets.roads.get(extent.sections[0].roadId);
        if (!road) throw new StreetExtentError("A matched street is unavailable. Try again.");
        const item = applyRoadSections({ ...base, id: crypto.randomUUID(), kind: action.kind as "closure" | "construction" | "accident", position: [road.geometry.coordinates[0][0], road.geometry.coordinates[0][1]], roadId: road.properties.id, restriction, travelDirection: movement, ...(groupId ? { groupId } : {}) }, extent.sections, streets.roads);
        if (!validRoadExtent(item, id => streets.roads.get(id)?.geometry.coordinates)) throw new StreetExtentError("Those streets do not form a continuous supported closure. Check the cross-streets.");
        return validate({ ...item, locationLabel: `${extent.roadName}: ${extent.fromStreet} → ${extent.toStreet} · ${movement === "both" ? "both directions" : movement}` });
      });
    }
    const road = roads.find(r => r.id === action.roadId);
    if (!road) throw new StreetExtentError("Describe the road and both cross-streets, for example Queen Street from Spadina Avenue to University Avenue.");
    const p = road.coords[Math.floor(road.coords.length / 2)];
    return [validate({ ...base, kind: action.kind as "closure" | "construction" | "accident", position: [p[0], p[1]], roadId: road.id, restriction, travelDirection })];
  });
  if (proposals.length > 10) throw new StreetExtentError("This request creates too many separate road paths. Try fewer roads at once.", "limit");
  return proposals;
}

export type ChatTrafficContext = {
  date: string; minutes: number; day: "weekday" | "weekend";
  source: string;
  impacts: Record<string, Impact>;
};
