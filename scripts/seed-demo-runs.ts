/**
 * Adds sample saved runs to the Tiger Data scenario database so the Results panel has history to compare.
 * They are illustrative placeholders (model version "demo-seed"), not simulation output.
 *
 *   pnpm data:seed-runs          add the samples (replacing earlier samples)
 *   pnpm data:seed-runs --clear  remove the samples only
 *
 * Needs TIGER_DATABASE_URL (read from .env.local).
 */
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import type { RunPayload } from "../src/lib/run-payload";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
}
const { saveRun } = await import("../src/lib/runs-db");

const DEMO_VERSION = "demo-seed";

type Sample = { name: string; date: string; start: number; hours: number; extraPeak: number; delayHours: number; unfinished: number; roads: [string, number, number][]; disruptions: number };
const samples: Sample[] = [
  { name: "Gardiner closure · AM rush", date: "2026-10-20", start: 6 * 60, hours: 4, extraPeak: 1840, delayHours: 2650, unfinished: 120, disruptions: 1, roads: [["Lake Shore Blvd W", 96, 21], ["Front St W", 64, 14], ["Spadina Ave", 41, 11], ["Bathurst St", 33, 9]] },
  { name: "Jays game + Spadina lane closure", date: "2026-10-21", start: 17 * 60, hours: 4, extraPeak: 910, delayHours: 1180, unfinished: 45, disruptions: 2, roads: [["Spadina Ave", 72, 17], ["Blue Jays Way", 58, 12], ["Front St W", 39, 10]] },
  { name: "King St construction · weekday", date: "2026-10-22", start: 7 * 60, hours: 6, extraPeak: 420, delayHours: 610, unfinished: 12, disruptions: 1, roads: [["Queen St W", 35, 8], ["Adelaide St W", 28, 7], ["Richmond St W", 22, 6]] },
  { name: "DVP accident · PM rush", date: "2026-10-23", start: 16 * 60, hours: 3, extraPeak: 1320, delayHours: 1490, unfinished: 85, disruptions: 1, roads: [["Bayview Ave", 88, 19], ["Don Mills Rd", 61, 15], ["Broadview Ave", 37, 9]] },
  { name: "Bloor lane reduction · midday", date: "2026-10-24", start: 11 * 60, hours: 4, extraPeak: 260, delayHours: 330, unfinished: 6, disruptions: 1, roads: [["Bloor St W", 31, 7], ["Harbord St", 18, 5], ["Dupont St", 14, 4]] },
  { name: "Winter storm + Yonge closure", date: "2026-10-26", start: 7 * 60, hours: 5, extraPeak: 2210, delayHours: 3420, unfinished: 260, disruptions: 3, roads: [["Bay St", 104, 18], ["Mount Pleasant Rd", 79, 16], ["Avenue Rd", 66, 15], ["Church St", 40, 9]] },
];

/** A smooth rise-and-recover curve of extra vehicles over the run, peaking about a third of the way in. */
function sample(s: Sample): RunPayload {
  const end = s.start + s.hours * 60;
  const series = [];
  let baselineDelay = 0, scenarioDelay = 0;
  for (let minute = s.start; minute <= end; minute += 10) {
    const t = (minute - s.start) / (end - s.start);
    const baseline = 2600 + 900 * Math.sin(Math.PI * t);
    const extra = s.extraPeak * Math.max(0, Math.sin(Math.PI * Math.min(1, t * 1.4)));
    baselineDelay += baseline * 0.04;
    scenarioDelay += (baseline + extra) * 0.04 + extra * 0.12;
    series.push({ minute, baselineOnNetwork: Math.round(baseline), scenarioOnNetwork: Math.round(baseline + extra), baselineDelay: Math.round(baselineDelay), scenarioDelay: Math.round(scenarioDelay) });
  }
  // Scale the cumulative scenario delay so the headline matches the sample's stated extra delay.
  const scale = (s.delayHours * 60) / Math.max(1, series.at(-1)!.scenarioDelay - series.at(-1)!.baselineDelay);
  for (const point of series) point.scenarioDelay = Math.round(point.baselineDelay + (point.scenarioDelay - point.baselineDelay) * scale);
  const peak = series.reduce((best, p) => p.scenarioOnNetwork - p.baselineOnNetwork > best.scenarioOnNetwork - best.baselineOnNetwork ? p : best);
  return {
    name: s.name, date: s.date, weather: { rainMmPerHour: s.name.includes("storm") ? 2 : 0, snowCmPerHour: s.name.includes("storm") ? 1.5 : 0 },
    disruptions: Array.from({ length: s.disruptions }, (_, i) => ({ id: `demo-${i}`, sample: true })), modelVersion: DEMO_VERSION, dataVersion: DEMO_VERSION,
    summary: {
      start: s.start, end, extraDelayHours: s.delayHours, peakExtraVehicles: peak.scenarioOnNetwork - peak.baselineOnNetwork, peakMinute: peak.minute, unfinishedTrips: s.unfinished,
      topRoads: s.roads.map(([name, extraQueue, speedDropKmh], i) => ({ id: `demo-${i}`, name, extraQueue, speedDropKmh })), series,
    },
  };
}

const url = new URL(process.env.TIGER_DATABASE_URL ?? "");
url.searchParams.delete("sslmode");
const { rootCertificates } = await import("node:tls");
const db = new Pool({ connectionString: url.toString(), ssl: { ca: [...rootCertificates, readFileSync("certs/timescale-ca.pem", "utf8")] } });
// Saving a run creates the tables on first use; only delete once they exist.
const exists = await db.query("SELECT to_regclass('scenario_runs') AS t");
if (exists.rows[0].t) {
  const removed = await db.query("DELETE FROM scenario_runs WHERE model_version = $1", [DEMO_VERSION]);
  console.log(`Removed ${removed.rowCount} earlier sample runs.`);
}
if (!process.argv.includes("--clear")) {
  for (const s of samples) await saveRun(sample(s));
  console.log(`Added ${samples.length} sample runs.`);
}
await db.query("CALL refresh_continuous_aggregate('run_metrics_hourly', NULL, NULL)").catch(() => undefined);
await db.end();
process.exit(0);
