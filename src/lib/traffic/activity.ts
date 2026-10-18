import schedule from "../data/venue-events.json";
import type { TrafficData, DayType } from "./types";

export const ACTIVITY_SOURCES = {
  employment: "https://www.toronto.ca/legdocs/mmis/2025/ph/bgrd/backgroundfile-260094.pdf",
  arena: "https://www.scotiabankarena.com/venue-information/about",
  baseball: "https://www.mlb.com/bluejays/ballpark/information/history",
  schedule: schedule.source,
  cityEvents: "https://open.toronto.ca/dataset/festivals-events/",
  nhl: "https://api-web.nhle.com/v1/club-schedule-season/TOR/",
};
export const EMPLOYMENT_STATS = { year: 2025, cityJobs: 1623710, downtownJobs: 664650, fourCentresJobs: 77460, source: ACTIVITY_SOURCES.employment };
// Approximate entrance coordinates; capacities are context, never assumed attendance.
export const VENUES = [
  { id: "rogers-centre", name: "Rogers Centre", position: [-79.3894, 43.6414] as [number, number], capacity: 40000, source: ACTIVITY_SOURCES.baseball },
  { id: "scotiabank-arena", name: "Scotiabank Arena", position: [-79.3791, 43.6435] as [number, number], capacity: 19800, source: ACTIVITY_SOURCES.arena },
  { id: "bmo-field", name: "BMO Field", position: [-79.4186, 43.6332] as [number, number], capacity: 27980, source: "https://www.bmofield.com/events/fifa26" },
  { id: "rbc-amphitheatre", name: "RBC Amphitheatre (formerly Budweiser Stage)", position: [-79.4152, 43.6293] as [number, number], capacity: 16000, source: "https://www.livenation.com/venue/KovZpZAEkkIA/rbc-am" },
];
// The survey reports 664,650 Downtown jobs and 77,460 across the four Centres.
// Centre coordinates, influence radii and traffic weights below are modeling assumptions.
export const EMPLOYMENT_HUBS = [
  { name: "Downtown / Financial District", position: [-79.381, 43.649] as [number, number], radiusM: 2300, weight: 1 },
  { name: "North York Centre", position: [-79.413, 43.768] as [number, number], radiusM: 1300, weight: 0.55 },
  { name: "Yonge–Eglinton", position: [-79.398, 43.707] as [number, number], radiusM: 1100, weight: 0.5 },
  { name: "Scarborough Centre", position: [-79.257, 43.775] as [number, number], radiusM: 1400, weight: 0.5 },
  { name: "Etobicoke Centre", position: [-79.535, 43.643] as [number, number], radiusM: 1300, weight: 0.4 },
];
export type ActivityContext = { minutes: number; date?: string; suppressedVenues?: string[] };
export type RoadActivity = { employment: number; venues: { id: string; proximity: number }[] };
const distance = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 80000, (a[1] - b[1]) * 111000);
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" });
const localTime = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
type ScheduleEvent = { id: string; title: string; startsAt: string; kind?: "game" | "community"; venueId?: string; position?: [number, number]; category?: string };
const placeId = (position: [number, number]) => `place:${position[0].toFixed(4)},${position[1].toFixed(4)}`;
export const VENUE_EVENTS = (schedule.events as ScheduleEvent[]).map(event => {
  const start = new Date(event.startsAt);
  const [hour, minute] = localTime.format(start).split(":").map(Number);
  const venueId = event.venueId ?? (event.position ? placeId(event.position) : "");
  return { ...event, venueId, kind: event.kind ?? "game", date: localDate.format(start), minutes: hour * 60 + minute };
});
/** City-listed event locations (festivals, parades, concerts) away from the large venues. */
export const COMMUNITY_PLACES = [...new Map((schedule.events as ScheduleEvent[]).filter(e => e.position).map(e => [placeId(e.position!), e.position!])).entries()]
  .map(([id, position]) => ({ id, position }));
/** Illustrative peak uplift on roads right beside an event, by event type; attendance is not published. */
const EVENT_WEIGHT: Record<string, number> = { game: 0.45, Parade: 0.3, Celebrations: 0.22, Festival: 0.22, Sports: 0.18, Music: 0.08 };
const COMMUNITY_RADIUS_M = 600;
const VENUE_RADIUS_M = 1400;
const eventsByDate = new Map<string, typeof VENUE_EVENTS>();
for (const event of VENUE_EVENTS) eventsByDate.set(event.date, [...(eventsByDate.get(event.date) ?? []), event]);

export function enrichTrafficData(data: TrafficData): TrafficData {
  return { ...data, segments: data.segments.map(road => {
    const middle = road.coords[Math.floor(road.coords.length / 2)];
    return { ...road, activity: {
      employment: Math.max(0, ...EMPLOYMENT_HUBS.map(h => h.weight * Math.max(0, 1 - distance(middle, h.position) / h.radiusM))),
      venues: [
        ...VENUES.map(v => ({ id: v.id, proximity: Math.max(0, 1 - distance(middle, v.position) / VENUE_RADIUS_M) })),
        ...COMMUNITY_PLACES.map(p => ({ id: p.id, proximity: Math.abs(middle[1] - p.position[1]) > 0.006 ? 0 : Math.max(0, 1 - distance(middle, p.position) / COMMUNITY_RADIUS_M) })),
      ].filter(v => v.proximity > 0),
    } };
  }) };
}

/** Bounded illustrative changes to count-based demand, not observed event traffic. */
export function activityFactor(activity: RoadActivity | undefined, day: DayType, context?: ActivityContext) {
  if (!activity || !context) return 1;
  const peak = (at: number, spread: number) => Math.exp(-0.5 * ((context.minutes - at) / spread) ** 2);
  // Existing counts already include commuting. Reshape slightly rather than adding jobs as cars.
  let factor = day === "weekday" ? 1 + activity.employment * 0.16 * (peak(510, 75) + peak(1020, 90)) : 1;
  const today = context.date ? eventsByDate.get(context.date) ?? [] : [];
  for (const venue of activity.venues) {
    if (context.suppressedVenues?.includes(venue.id)) continue;
    for (const event of today) {
      if (event.venueId !== venue.id) continue;
      // Arrival before the start and departure after an assumed ~3-hour game or ~2.5-hour event; actual duration and
      // attendance are unknown, so the uplift is bounded and weighted by event type.
      const length = event.kind === "game" ? 195 : 150;
      const arrival = Math.max(0, 1 - Math.abs(context.minutes - (event.minutes - 35)) / 90);
      const departure = Math.max(0, 1 - Math.abs(context.minutes - (event.minutes + length)) / 75);
      factor += venue.proximity * (EVENT_WEIGHT[event.kind === "game" ? "game" : event.category ?? "Music"] ?? 0.1) * Math.max(arrival, departure);
    }
  }
  return Math.min(1.7, factor);
}

export function suppressedVenues(items: { kind: string; position: number[] }[]) {
  return VENUES.filter(v => items.some(item => item.kind === "event" && distance(item.position, v.position) < 500)).map(v => v.id);
}
