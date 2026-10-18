import { validateDisruption, type Disruption } from "../disruptions";
import { shiftSimulationDate, validSimulationDate } from "./simulation-date";
import type { TrafficSegment } from "./types";
import { VENUES } from "./activity";

export type ChatAction = { kind: string; title: string; roadId?: string; venueId?: string; attendance?: number; startMinutes: number; durationMinutes: number };
export function chatDisruptions(actions: unknown, roads: TrafficSegment[], date: string): Disruption[] {
  if (!validSimulationDate(date) || !Array.isArray(actions) || actions.length > 5) throw new Error("Invalid scenario proposal");
  return actions.map((action: ChatAction) => {
    if (!action || !["event", "closure", "construction", "accident"].includes(action.kind) || typeof action.title !== "string" || !Number.isInteger(action.startMinutes) || action.startMinutes < 0 || action.startMinutes >= 1440 || !Number.isInteger(action.durationMinutes) || action.durationMinutes < 1 || action.durationMinutes > 1440) throw new Error("Invalid event or time");
    const stamp = (minutes: number) => `${shiftSimulationDate(date, Math.floor(minutes / 1440))}T${String(Math.floor((minutes % 1440) / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const base = { id: crypto.randomUUID(), title: action.title, startsAt: stamp(action.startMinutes), endsAt: stamp(action.startMinutes + action.durationMinutes), timeZone: "America/Toronto" as const };
    let item: Disruption;
    if (action.kind === "event") {
      const venue = VENUES.find(v => v.id === action.venueId);
      if (!venue || !Number.isInteger(action.attendance) || action.attendance! < 0 || action.attendance! > venue.capacity) throw new Error("Choose a supported venue and attendance within its capacity");
      item = { ...base, kind: "event", position: venue.position, attendance: action.attendance! };
    } else {
      const road = roads.find(r => r.id === action.roadId);
      if (!road) throw new Error("Unknown road");
      const p = road.coords[Math.floor(road.coords.length / 2)];
      item = { ...base, kind: action.kind as "closure" | "construction" | "accident", position: [p[0], p[1]], roadId: road.id, restriction: action.kind === "closure" ? "full-closure" : "lane-reduction" };
    }
    const error = validateDisruption(item);
    if (error) throw new Error(error);
    return item;
  });
}

export type ChatTrafficContext = {
  date: string; minutes: number; day: "weekday" | "weekend";
  source: string;
  impacts: Record<string, { addedHourly: number; retained: number; capacityScale: number }>;
};
