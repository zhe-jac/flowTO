import { writeFile } from "node:fs/promises";
const year = Number(process.argv[2] ?? new Date().getFullYear());
if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Supply a valid year");
const source = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&teamId=141&startDate=${year}-01-01&endDate=${year}-12-31`;
const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Schedule download failed (${response.status})`);
const data = await response.json() as { dates: { games: { gamePk: number; gameDate: string; status: { detailedState: string }; venue: { id: number }; teams: { home: { team: { id: number } }; away: { team: { name: string } } } }[] }[] };
const events = data.dates.flatMap(day => day.games).filter(g => g.teams.home.team.id === 141 && g.venue.id === 14 && !/Cancelled|Postponed/.test(g.status.detailedState))
  .map(g => ({ id: String(g.gamePk), title: `${g.teams.away.team.name} at Toronto Blue Jays`, venueId: "rogers-centre", startsAt: g.gameDate }));
if (!events.length) throw new Error("No Toronto home games found; existing snapshot retained");
await writeFile("src/lib/data/venue-events.json", JSON.stringify({ retrievedAt: new Date().toISOString(), source, events }, null, 2) + "\n");
console.log(`Saved ${events.length} published Toronto home games for ${year}`);
