import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isPointInToronto } from "../src/lib/city-boundary";

const year = Number(process.argv[2] ?? new Date().getFullYear());
if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Supply a valid year");

type ScheduledEvent = {
  id: string;
  title: string;
  startsAt: string;
  kind: "game" | "community";
  /** Known large venue (see VENUES in src/lib/traffic/activity.ts). */
  venueId?: string;
  /** City-listed event location, for events away from the large venues. */
  position?: [number, number];
  category?: string;
  endsAt?: string;
};

const inYear = (iso: string) => iso.startsWith(String(year));

// Toronto Blue Jays home games at Rogers Centre (MLB Stats API).
const mlbSource = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=141&startDate=${year}-01-01&endDate=${year}-12-31`;
async function blueJays(): Promise<ScheduledEvent[]> {
  const response = await fetch(mlbSource, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`MLB schedule download failed (${response.status})`);
  const data = await response.json() as { dates: { games: { gamePk: number; gameDate: string; status: { detailedState: string }; venue: { id: number }; teams: { home: { team: { id: number } }; away: { team: { name: string } } } }[] }[] };
  return data.dates.flatMap(day => day.games).filter(g => g.teams.home.team.id === 141 && g.venue.id === 14 && !/Cancelled|Postponed/.test(g.status.detailedState))
    .map(g => ({ id: `mlb-${g.gamePk}`, title: `${g.teams.away.team.name} at Toronto Blue Jays`, venueId: "rogers-centre", startsAt: g.gameDate, kind: "game" }));
}

// Toronto Maple Leafs home games at Scotiabank Arena (NHL web API); a calendar year spans two seasons.
const nhlSource = (season: string) => `https://api-web.nhle.com/v1/club-schedule-season/TOR/${season}`;
async function mapleLeafs(): Promise<ScheduledEvent[]> {
  const events: ScheduledEvent[] = [];
  for (const season of [`${year - 1}${year}`, `${year}${year + 1}`]) {
    const response = await fetch(nhlSource(season), { signal: AbortSignal.timeout(20000) });
    if (!response.ok) continue;
    const data = await response.json() as { games: { id: number; startTimeUTC: string; gameScheduleState: string; homeTeam: { abbrev: string }; awayTeam: { commonName?: { default: string }; abbrev: string }; venue?: { default: string } }[] };
    for (const g of data.games) {
      if (g.homeTeam.abbrev !== "TOR" || !inYear(g.startTimeUTC) || g.gameScheduleState === "CNCL") continue;
      if (g.venue?.default && !/Scotiabank/i.test(g.venue.default)) continue;
      events.push({ id: `nhl-${g.id}`, title: `${g.awayTeam.commonName?.default ?? g.awayTeam.abbrev} at Toronto Maple Leafs`, venueId: "scotiabank-arena", startsAt: g.startTimeUTC, kind: "game" });
    }
  }
  return events;
}

// City of Toronto Festivals & Events feed: short festivals, parades, celebrations, sports and concerts with a mapped
// location. Long-running exhibitions and recurring programmes are skipped. The feed is large, so it is cached.
const citySource = "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/9201059e-43ed-4369-885e-0b867652feac/resource/8900fdb2-7f6c-4f50-8581-b463311ff05d/download/file.json";
const CITY_CATEGORIES = ["Parade", "Celebrations", "Festival", "Sports", "Music"];
async function cityEvents(): Promise<ScheduledEvent[]> {
  const cache = "data/raw/city-festivals-events.json";
  await mkdir("data/raw", { recursive: true });
  let text: string;
  try {
    if ((await stat(cache)).size === 0) throw new Error();
    text = await readFile(cache, "utf8");
  } catch {
    const response = await fetch(citySource, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`City events download failed (${response.status})`);
    text = await response.text();
    await writeFile(cache, text);
  }
  type CityEvent = { id: string; event_name: string; calendar_date?: string; event_startdate?: string; event_enddate?: string; event_category?: string[]; event_locations?: { location_gps?: string }[] };
  const records = (JSON.parse(text) as { value: CityEvent[] }).value;
  const seen = new Set<string>();
  const events: ScheduledEvent[] = [];
  for (const record of records) {
    const category = CITY_CATEGORIES.find(name => record.event_category?.includes(name));
    const startsAt = record.calendar_date;
    if (!category || !startsAt || !inYear(startsAt)) continue;
    const span = (Date.parse(record.event_enddate ?? "") - Date.parse(record.event_startdate ?? "")) / 86400000;
    if (!Number.isFinite(span) || span > 4) continue;
    let position: [number, number] | undefined;
    for (const location of record.event_locations ?? []) {
      try {
        const [gps] = JSON.parse(location.location_gps ?? "[]") as { gps_lat: number | string; gps_lng: number | string }[];
        if (gps) position = [Number(Number(gps.gps_lng).toFixed(5)), Number(Number(gps.gps_lat).toFixed(5))];
      } catch { /* unparseable location */ }
      if (position) break;
    }
    if (!position || !position.every(Number.isFinite) || !isPointInToronto(position)) continue;
    const key = `${record.event_name}|${startsAt.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ id: `city-${record.id}-${startsAt.slice(0, 10)}`, title: record.event_name, position, startsAt: new Date(startsAt).toISOString(), kind: "community", category });
  }
  return events;
}

const settled = await Promise.allSettled([blueJays(), mapleLeafs(), cityEvents()]);
const [jays, leafs, city] = settled.map(result => result.status === "fulfilled" ? result.value : []);
settled.forEach((result, i) => { if (result.status === "rejected") console.warn(`${["Blue Jays", "Maple Leafs", "City events"][i]} skipped:`, result.reason); });
if (!jays.length && !leafs.length) throw new Error("No sports schedules downloaded; existing snapshot retained");
const events = [...jays, ...leafs, ...city].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
// Blue Jays games stay first so existing consumers that read VENUE_EVENTS[0] get a venue game.
events.sort((a, b) => Number(b.venueId === "rogers-centre") - Number(a.venueId === "rogers-centre") || a.startsAt.localeCompare(b.startsAt));
await writeFile("src/lib/data/venue-events.json", JSON.stringify({
  retrievedAt: new Date().toISOString(),
  source: mlbSource,
  sources: [
    { name: "MLB Stats API: Toronto Blue Jays schedule", url: mlbSource },
    { name: "NHL: Toronto Maple Leafs schedule", url: nhlSource(`${year - 1}${year}`) },
    { name: "City of Toronto Open Data: Festivals & Events", url: "https://open.toronto.ca/dataset/festivals-events/" },
  ],
  events,
}) + "\n");
console.log(`Saved ${jays.length} Blue Jays, ${leafs.length} Maple Leafs and ${city.length} City events for ${year}`);
