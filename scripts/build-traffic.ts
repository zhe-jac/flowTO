import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { FeatureCollection, MultiLineString } from "geojson";
import { isPointInToronto, TORONTO_BOUNDS } from "../src/lib/city-boundary";
import { CLASS_ASSUMPTIONS, type DayType, type TrafficData, type TrafficSegment, type VolumeSource } from "../src/lib/traffic/types";

// Defaults to the whole City of Toronto; MAP_BOUNDS=west,south,east,north limits it to a smaller area.
const bounds = process.env.MAP_BOUNDS ? process.env.MAP_BOUNDS.split(",").map(Number) : TORONTO_BOUNDS.flat();
if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) throw new Error("MAP_BOUNDS must be west,south,east,north");
const [west, south, east, north] = bounds;
const TARGET_PEAK_DOTS = 16000;
const SAME_STREET_LIMIT_M = 1500;
// Expressway counts below this are partial-lane or short counts; full carriageways carry far more.
const MIN_EXPRESSWAY_DAILY = 20000;

const sources = {
  centreline: {
    path: "data/raw/centreline.geojson",
    url: "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/1d079757-377b-4564-82df-eb5638583bfb/resource/7bc94ccf-7bcf-4a7d-88b1-bdfc8ec5aaf1/download/centreline-version-2-4326.geojson",
  },
  midblock: {
    path: "data/raw/svc_most_recent_summary.csv",
    url: "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7a0ac637-43da-4e42-a79c-6d8279e21d85/resource/68c727f5-fd14-46e1-9023-1cd002ab7294/download/svc_most_recent_summary_data.csv",
  },
  midblockRaw: {
    path: "data/raw/svc_raw_volume_2020_2024.csv",
    url: "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/7a0ac637-43da-4e42-a79c-6d8279e21d85/resource/2aef8448-455c-4d61-8480-4fa38b5acf9a/download/svc_raw_data_volume_2020_2024.csv",
  },
  intersection: {
    path: "data/raw/tmc_most_recent_summary.csv",
    url: "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/811c4c10-7e5d-4c76-8d42-dab4e31c8265/resource/d5999173-dd33-4156-a5c7-bbbf2d2763b8/download/tmc_most_recent_summary_data.csv",
  },
};

async function cached(source: { path: string; url: string }) {
  try {
    if ((await stat(source.path)).size > 0) return readFile(source.path, "utf8");
  } catch {}
  console.log(`Downloading ${source.url}`);
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${source.url}`);
  const text = await response.text();
  await writeFile(source.path, text);
  return text;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

const radians = Math.PI / 180;
function metres(a: number[], b: number[]) {
  const lat = (b[1] - a[1]) * radians;
  const lon = (b[0] - a[0]) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function bearing(from: number[], to: number[]) {
  const y = Math.sin((to[0] - from[0]) * radians) * Math.cos(to[1] * radians);
  const x = Math.cos(from[1] * radians) * Math.sin(to[1] * radians) - Math.sin(from[1] * radians) * Math.cos(to[1] * radians) * Math.cos((to[0] - from[0]) * radians);
  return (Math.atan2(y, x) / radians + 360) % 360;
}
const compass = (degrees: number) => (["n", "e", "s", "w"] as const)[Math.round(degrees / 90) % 4];

await mkdir("data/raw", { recursive: true });
await mkdir("public/data", { recursive: true });
const [centrelineText, midblockText, midblockRawText, intersectionText] = await Promise.all([
  cached(sources.centreline), cached(sources.midblock), cached(sources.midblockRaw), cached(sources.intersection),
]);

// 1. Time-of-day profiles: share of a day's traffic in each 15-minute bin, from complete 24-hour midblock count days.
const dayBins = new Map<string, { weekend: boolean; bins: number[] }>();
for (const row of parseCsv(midblockRawText)) {
  const time = row.time_start;
  if (!time) continue;
  const date = time.slice(0, 10);
  const key = `${row.count_id}|${row.direction}|${date}`;
  let day = dayBins.get(key);
  if (!day) {
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    day = { weekend: weekday === 0 || weekday === 6, bins: new Array(96).fill(0) };
    dayBins.set(key, day);
  }
  day.bins[Number(time.slice(11, 13)) * 4 + Math.floor(Number(time.slice(14, 16)) / 15)] += Number(row.volume_15min) || 0;
}
const profiles: Record<DayType, number[]> = { weekday: new Array(96).fill(0), weekend: new Array(96).fill(0) };
const profileDays: Record<DayType, number> = { weekday: 0, weekend: 0 };
for (const day of dayBins.values()) {
  const total = day.bins.reduce((sum, value) => sum + value, 0);
  if (total < 200 || day.bins.slice(24, 88).some((value) => value === 0)) continue;
  const type: DayType = day.weekend ? "weekend" : "weekday";
  day.bins.forEach((value, index) => { profiles[type][index] += value / total; });
  profileDays[type]++;
}
for (const type of ["weekday", "weekend"] as const) {
  if (!profileDays[type]) throw new Error(`No complete ${type} count days found`);
  // Light smoothing removes single-bin noise from a small sample of count days.
  const raw = profiles[type];
  const smooth = raw.map((_, i) => (raw[(i + 95) % 96] + 2 * raw[i] + raw[(i + 1) % 96]) / 4);
  const total = smooth.reduce((sum, value) => sum + value, 0);
  profiles[type] = smooth.map((value) => Number((value / total).toFixed(6)));
}

// 2. Road segments in the demo area.
type RawSegment = TrafficSegment & { from: string; to: string; key: string };
const centreline = JSON.parse(centrelineText) as FeatureCollection<MultiLineString>;
const classById = new Map<string, string>();
const segments: RawSegment[] = [];
for (const feature of centreline.features) {
  const p = feature.properties as Record<string, unknown> | null;
  if (!p || !feature.geometry) continue;
  const cls = String(p.FEATURE_CODE_DESC);
  classById.set(String(p.CENTRELINE_ID), cls);
  if (!(cls in CLASS_ASSUMPTIONS)) continue;
  const parts = feature.geometry.coordinates.filter((part) => part.length > 1);
  for (const [index, part] of parts.entries()) {
    if (!part.some(([lon, lat]) => lon >= west && lon <= east && lat >= south && lat <= north)) continue;
    const middle = part[Math.floor(part.length / 2)];
    if (!isPointInToronto([middle[0], middle[1]])) continue;
    const oneway = p.ONEWAY_DIR_CODE_DESC === "Follow-Digitization" ? 1 : p.ONEWAY_DIR_CODE_DESC === "Against-Digitization" ? -1 : 0;
    const length = part.slice(1).reduce((sum, point, i) => sum + metres(part[i], point), 0);
    if (length < 1) continue;
    const id = parts.length === 1 ? String(p.CENTRELINE_ID) : `${p.CENTRELINE_ID}:${index}`;
    segments.push({
      id,
      key: String(p.CENTRELINE_ID),
      name: String(p.LINEAR_NAME_FULL || "Unnamed road"),
      cls,
      oneway,
      lengthM: Math.round(length),
      weekdayDaily: 0,
      weekendDaily: 0,
      source: { kind: "class" },
      from: String(p.FROM_INTERSECTION_ID),
      to: String(p.TO_INTERSECTION_ID),
      // Five decimals is about one metre, which keeps the citywide file small.
      coords: part.map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))]),
    });
  }
}

// 3. Midblock counts: measured daily volumes on a specific Centreline segment.
const midblock = new Map<string, Record<string, string>>();
const weekendRatios = new Map<string, number[]>();
const classDaily = new Map<string, number[]>();
for (const row of parseCsv(midblockText)) {
  const weekday = Number(row.avg_weekday_daily_vol) || Number(row.avg_daily_vol);
  if (!(weekday > 0) || Number(row.latest_count_date_start.slice(0, 4)) < 2005) continue;
  const cls = classById.get(row.centreline_id);
  if (!cls) continue;
  if (cls === "Expressway" && weekday < MIN_EXPRESSWAY_DAILY) continue;
  midblock.set(row.centreline_id, row);
  if (!classDaily.has(cls)) classDaily.set(cls, []);
  classDaily.get(cls)!.push(weekday);
  const weekend = Number(row.avg_weekend_daily_vol);
  if (weekend > 0) {
    if (!weekendRatios.has(cls)) weekendRatios.set(cls, []);
    weekendRatios.get(cls)!.push(weekend / weekday);
  }
}
const allRatios = [...weekendRatios.values()].flat();
const weekendRatio = (cls: string) => {
  const values = weekendRatios.get(cls) ?? [];
  return values.length >= 5 ? median(values) : median(allRatios);
};

// 4. Intersection counts: approach volumes by compass leg, scaled from the counted hours to a full day.
const intersection = new Map<string, Record<string, string>>();
for (const row of parseCsv(intersectionText)) {
  if (row.centreline_type === "2" && Number(row.latest_count_date.slice(0, 4)) >= 2010) intersection.set(row.centreline_id, row);
}
const hourShare = (hours: number[][]) => hours.reduce((sum, [start, end]) => sum + profiles.weekday.slice(start * 4, end * 4).reduce((a, b) => a + b, 0), 0);
// 8-hour counts cover 07:30–09:30, 10:00–12:00, 13:00–15:00, 16:00–18:00; 14-hour counts cover 06:00–20:00.
const coverage8 = hourShare([[7.5, 9.5], [10, 12], [13, 15], [16, 18]]);
const coverage14 = hourShare([[6, 20]]);

const measuredDaily = new Map<RawSegment, number>();
for (const segment of segments) {
  const count = midblock.get(segment.key);
  if (count) {
    const weekday = Number(count.avg_weekday_daily_vol) || Number(count.avg_daily_vol);
    const weekend = Number(count.avg_weekend_daily_vol);
    segment.weekdayDaily = weekday;
    segment.weekendDaily = weekend > 0 ? weekend : weekday * weekendRatio(segment.cls);
    segment.source = { kind: "midblock", label: count.location_name, date: count.latest_count_date_start };
    measuredDaily.set(segment, weekday);
    continue;
  }
  const estimates: { daily: number; row: Record<string, string> }[] = [];
  // Expressways are grade-separated: intersection counts beneath them measure the cross street.
  for (const end of segment.cls === "Expressway" ? [] : (["from", "to"] as const)) {
    const row = intersection.get(segment[end]);
    if (!row) continue;
    const coords = segment.coords;
    const atStart = end === "from";
    const origin = atStart ? coords[0] : coords[coords.length - 1];
    const toward = atStart ? coords[Math.min(coords.length - 1, 1)] : coords[Math.max(0, coords.length - 2)];
    const approach = Number(row[`${compass(bearing(origin, toward))}_appr_vehicle`]);
    if (!(approach > 0)) continue;
    // Approach volume counts vehicles entering the intersection from this leg.
    const flowsIntoIntersection = segment.oneway === 0 || (segment.oneway === 1) !== atStart;
    if (!flowsIntoIntersection) continue;
    const coverage = row.count_duration === "14" ? coverage14 : coverage8;
    estimates.push({ daily: (approach / coverage) * (segment.oneway === 0 ? 2 : 1), row });
  }
  if (estimates.length) {
    const daily = estimates.reduce((sum, item) => sum + item.daily, 0) / estimates.length;
    segment.weekdayDaily = daily;
    segment.weekendDaily = daily * weekendRatio(segment.cls);
    segment.source = { kind: "intersection", label: estimates[0].row.location_name, date: estimates[0].row.latest_count_date };
    measuredDaily.set(segment, daily);
  }
}

// 5. Same-street estimates: nearest counted segment along connected roads with the same name.
const byNode = new Map<string, RawSegment[]>();
for (const segment of segments) {
  for (const node of [segment.from, segment.to]) {
    if (!byNode.has(node)) byNode.set(node, []);
    byNode.get(node)!.push(segment);
  }
}
const best = new Map<RawSegment, { distance: number; origin: RawSegment }>();
const queue: { segment: RawSegment; distance: number; origin: RawSegment }[] = [];
for (const segment of measuredDaily.keys()) {
  best.set(segment, { distance: 0, origin: segment });
  queue.push({ segment, distance: 0, origin: segment });
}
while (queue.length) {
  queue.sort((a, b) => b.distance - a.distance);
  const { segment, distance, origin } = queue.pop()!;
  if ((best.get(segment)?.distance ?? Infinity) < distance) continue;
  for (const node of [segment.from, segment.to]) {
    for (const next of byNode.get(node) ?? []) {
      if (next === segment || next.name !== segment.name || next.name === "Unnamed road") continue;
      const nextDistance = distance + next.lengthM;
      if (nextDistance > SAME_STREET_LIMIT_M || nextDistance >= (best.get(next)?.distance ?? Infinity)) continue;
      best.set(next, { distance: nextDistance, origin });
      queue.push({ segment: next, distance: nextDistance, origin });
    }
  }
}
for (const [segment, { distance, origin }] of best) {
  if (measuredDaily.has(segment)) continue;
  const scale = segment.oneway !== 0 && origin.oneway === 0 ? 0.5 : segment.oneway === 0 && origin.oneway !== 0 ? 2 : 1;
  segment.weekdayDaily = origin.weekdayDaily * scale;
  segment.weekendDaily = origin.weekendDaily * scale;
  segment.source = { kind: "street", label: origin.source.kind === "class" ? undefined : origin.source.label, date: origin.source.kind === "class" ? undefined : origin.source.date, distanceM: Math.round(distance) };
}

// 6. Remaining segments: citywide median of counted roads in the same class.
for (const segment of segments) {
  if (segment.weekdayDaily > 0) continue;
  const typical = median(classDaily.get(segment.cls) ?? []);
  const daily = Number.isFinite(typical) ? typical : CLASS_ASSUMPTIONS[segment.cls].fallbackDaily;
  // Expressway counts are per carriageway (one direction); other classes count both directions.
  const perDirectionCounts = segment.cls === "Expressway";
  segment.weekdayDaily = daily * (segment.oneway === 0 ? (perDirectionCounts ? 2 : 1) : perDirectionCounts ? 1 : 0.5);
  segment.weekendDaily = segment.weekdayDaily * weekendRatio(segment.cls);
  segment.source = { kind: "class", samples: classDaily.get(segment.cls)?.length ?? 0 };
}

// 7. Scale dots so the busiest weekday 15 minutes shows about TARGET_PEAK_DOTS moving vehicles.
const { vehiclesOnRoad } = await import("../src/lib/traffic/model");
let peakVehicles = 0;
for (let bin = 0; bin < 96; bin++) {
  let total = 0;
  for (const segment of segments) total += vehiclesOnRoad(segment, profiles.weekday[bin]);
  peakVehicles = Math.max(peakVehicles, total);
}
const vehiclesPerDot = Math.max(1, Math.round(peakVehicles / TARGET_PEAK_DOTS));

const counts = { midblock: 0, intersection: 0, street: 0, class: 0 } satisfies Record<VolumeSource["kind"], number>;
for (const segment of segments) counts[segment.source.kind]++;

const output: TrafficData = {
  meta: {
    builtAt: new Date().toISOString(),
    bounds: [west, south, east, north],
    vehiclesPerDot,
    profileDays,
    sourceCounts: counts,
    sources: [
      { name: "Toronto Centreline (TCL)", url: "https://open.toronto.ca/dataset/toronto-centreline-tcl/" },
      { name: "Traffic Volumes – Midblock Vehicle Speed, Volume and Classification Counts", url: "https://open.toronto.ca/dataset/traffic-volumes-midblock-vehicle-speed-volume-and-classification-counts/" },
      { name: "Traffic Volumes – Multimodal Intersection Turning Movement Counts", url: "https://open.toronto.ca/dataset/traffic-volumes-at-intersections-for-all-modes/" },
    ],
    licence: "Contains information licensed under the Open Government Licence – Toronto.",
  },
  profiles,
  segments: segments.map(({ from: _from, to: _to, key: _key, ...segment }) => ({
    ...segment,
    weekdayDaily: Math.round(segment.weekdayDaily),
    weekendDaily: Math.round(segment.weekendDaily),
  })),
};
await writeFile("public/data/traffic.json", JSON.stringify(output));
console.log(`Built ${segments.length} segments (${JSON.stringify(counts)}); profiles from ${profileDays.weekday} weekday and ${profileDays.weekend} weekend count days; 1 dot ≈ ${vehiclesPerDot} vehicles.`);
