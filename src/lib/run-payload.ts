import type { AffectedRoad, RunPoint } from "./traffic/run-metrics";

/** A simulation run as saved to the scenario database. */
export type RunPayload = {
  name: string;
  date: string;
  weather: { rainMmPerHour: number; snowCmPerHour: number };
  disruptions: unknown[];
  modelVersion: string;
  dataVersion: string;
  summary: {
    start: number;
    end: number;
    extraDelayHours: number;
    peakExtraVehicles: number;
    peakMinute: number;
    unfinishedTrips: number;
    topRoads: AffectedRoad[];
    series: RunPoint[];
  };
};

/** A saved run as listed back to the dashboard. */
export type SavedRun = {
  id: string;
  createdAt: string;
  name: string;
  date: string;
  start: number;
  end: number;
  disruptionCount: number;
  extraDelayHours: number;
  peakExtraVehicles: number;
  unfinishedTrips: number;
  topRoad: string | null;
};

const finite = (value: unknown, min = -1e9, max = 1e9): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;

/** Validates an untrusted run before it reaches the database; returns an error message or the cleaned payload. */
export function validateRunPayload(value: unknown): { error: string } | { run: RunPayload } {
  const body = value as Partial<RunPayload> | null;
  if (!body || typeof body !== "object") return { error: "Expected a run object." };
  if (!text(body.name, 80) || !body.name.trim()) return { error: "Give the run a name of up to 80 characters." };
  if (!text(body.date, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(body.date) || Number.isNaN(Date.parse(`${body.date}T12:00:00Z`))) return { error: "The run needs a valid date." };
  if (!body.weather || !finite(body.weather.rainMmPerHour, 0, 500) || !finite(body.weather.snowCmPerHour, 0, 500)) return { error: "The run needs valid weather rates." };
  if (!Array.isArray(body.disruptions) || body.disruptions.length > 40 || JSON.stringify(body.disruptions).length > 60000) return { error: "A run can include up to 40 disruptions." };
  if (!text(body.modelVersion, 60) || !text(body.dataVersion, 60)) return { error: "The run needs model and data versions." };
  const s = body.summary;
  if (!s || !finite(s.start, 0, 4320) || !finite(s.end, 0, 4320) || s.end < s.start) return { error: "The run needs a valid time window." };
  if (![s.extraDelayHours, s.peakExtraVehicles, s.peakMinute, s.unfinishedTrips].every(v => finite(v, -1e7, 1e7))) return { error: "The run summary has invalid numbers." };
  if (!Array.isArray(s.series) || !s.series.length || s.series.length > 600) return { error: "The run needs between 1 and 600 time points." };
  if (!s.series.every(p => p && [p.minute, p.baselineOnNetwork, p.scenarioOnNetwork, p.baselineDelay, p.scenarioDelay].every(v => finite(v, -1e9, 1e9)))) return { error: "A time point has invalid numbers." };
  if (!Array.isArray(s.topRoads) || s.topRoads.length > 20 || !s.topRoads.every(r => r && text(r.id, 40) && text(r.name, 120) && finite(r.extraQueue) && finite(r.speedDropKmh))) return { error: "The affected-road list is invalid." };
  return { run: { ...(body as RunPayload), name: body.name.trim() } };
}
