import type { SimulationResult } from "./simulation-types";

/** One point of the baseline-versus-scenario time series of a simulation run. */
export type RunPoint = {
  minute: number;
  baselineOnNetwork: number;
  scenarioOnNetwork: number;
  /** Cumulative vehicle-minutes of delay since the run started. */
  baselineDelay: number;
  scenarioDelay: number;
};

export type AffectedRoad = { id: string; name: string; extraQueue: number; speedDropKmh: number };

export type RunSummary = {
  start: number;
  end: number;
  /** Extra vehicle-hours of delay the scenario causes over the run. */
  extraDelayHours: number;
  /** Largest number of extra vehicles on the roads at any one time. */
  peakExtraVehicles: number;
  peakMinute: number;
  /** Trips still waiting or on the road at the end of the run, beyond the baseline. */
  unfinishedTrips: number;
  series: RunPoint[];
  topRoads: AffectedRoad[];
};

function unpack(values: string) {
  const raw = typeof atob === "function" ? atob(values) : Buffer.from(values, "base64").toString("binary");
  return new Uint16Array(Uint8Array.from(raw, c => c.charCodeAt(0)).buffer);
}

/**
 * Summarizes a simulation run for the dashboard. Per edge, each frame stores eight 16-bit values: flow, speed ×100,
 * queue ×10 and vehicles ×10 for the baseline, then the same four for the scenario.
 */
export function summarizeRun(result: SimulationResult, roadNames: ReadonlyMap<string, string>, limit = 8): RunSummary {
  const series: RunPoint[] = result.frames.map(frame => ({
    minute: frame.minute,
    baselineOnNetwork: frame.baseline.onNetwork,
    scenarioOnNetwork: frame.scenario.onNetwork,
    baselineDelay: frame.baseline.delayVehicleMinutes,
    scenarioDelay: frame.scenario.delayVehicleMinutes,
  }));
  const last = series.at(-1);
  let peakExtraVehicles = 0;
  let peakMinute = result.start;
  for (const point of series) {
    const extra = point.scenarioOnNetwork - point.baselineOnNetwork;
    if (extra > peakExtraVehicles) { peakExtraVehicles = extra; peakMinute = point.minute; }
  }
  const finalFrame = result.frames.at(-1);
  const unfinished = finalFrame
    ? Math.max(0, (finalFrame.scenario.onNetwork + finalFrame.scenario.pending) - (finalFrame.baseline.onNetwork + finalFrame.baseline.pending))
    : 0;

  // Worst roads: the largest extra queue each road reaches at any point, with the matching speed drop.
  const worst = new Map<string, AffectedRoad>();
  for (const frame of result.frames) {
    const values = unpack(frame.values);
    result.edges.forEach((edge, i) => {
      const offset = i * 8;
      const extraQueue = (values[offset + 6] - values[offset + 2]) / 10;
      if (extraQueue <= 0.5) return;
      const speedDropKmh = Math.max(0, (values[offset + 1] - values[offset + 5]) / 100);
      const current = worst.get(edge.id);
      if (!current || extraQueue > current.extraQueue) worst.set(edge.id, { id: edge.id, name: roadNames.get(edge.id) ?? "Unnamed road", extraQueue, speedDropKmh });
    });
  }
  // Several segments of one street usually appear together; keep the worst segment per street name.
  const byName = new Map<string, AffectedRoad>();
  for (const road of worst.values()) {
    const current = byName.get(road.name);
    if (!current || road.extraQueue > current.extraQueue) byName.set(road.name, road);
  }
  const topRoads = [...byName.values()].sort((a, b) => b.extraQueue - a.extraQueue).slice(0, limit);

  return {
    start: result.start,
    end: result.end,
    extraDelayHours: last ? Math.max(0, last.scenarioDelay - last.baselineDelay) / 60 : 0,
    peakExtraVehicles,
    peakMinute,
    unfinishedTrips: unfinished,
    series,
    topRoads,
  };
}
