/**
 * Local streets with no traffic count nearby all receive the citywide typical volume for their road type. This step
 * scales that typical volume by the street's neighbourhood population density (2016 Census, City neighbourhood
 * profiles), so local streets in dense neighbourhoods carry more traffic than those in sparse ones. Counted roads are
 * untouched. The step is idempotent: already-adjusted segments are skipped.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { isPointInBoundary } from "../src/lib/city-boundary";
import type { TrafficData } from "../src/lib/traffic/types";

const PROFILES_URL = "https://ckan0.cf.opendata.inter.prod-toronto.ca/datastore/dump/7f8eee5e-85fb-415c-aef3-c3bd4998445f";
const BOUNDARIES_URL = "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/fc443770-ef0a-4025-9c2c-2cb558bfab00/resource/9994da8e-5d35-438b-bfc4-eef14d09e035/download/neighbourhoods-historical-140-4326.geojson";
/** Road types whose untracked volume is scaled; expressways and ramps are not driven by local residents. */
const SCALED_CLASSES = new Set(["Local", "Collector", "Collector Ramp"]);
/** Density elasticity and bounds keep the adjustment modest: 4× the city density gives about +74%. */
const ELASTICITY = 0.4;
const LIMITS: [number, number] = [0.6, 1.6];

async function cached(path: string, url: string) {
  try {
    if ((await stat(path)).size > 0) return readFile(path, "utf8");
  } catch { /* not cached yet */ }
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const text = await response.text();
  await writeFile(path, text);
  return text;
}

function parseCsvRow(line: string) {
  const cells: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { cells.push(field); field = ""; }
    else field += char;
  }
  cells.push(field);
  return cells;
}

await mkdir("data/raw", { recursive: true });
const [profilesText, boundariesText, trafficText] = await Promise.all([
  cached("data/raw/nbhd-profiles-2016.csv", PROFILES_URL),
  cached("data/raw/nbhd-140.geojson", BOUNDARIES_URL),
  readFile("public/data/traffic.json", "utf8"),
]);

// Profile columns are neighbourhoods; rows hold "Neighbourhood Number" and "Population density per square kilometre".
const rows = profilesText.split(/\r?\n/).filter(Boolean).map(parseCsvRow);
const header = rows[0];
const characteristic = header.indexOf("Characteristic");
const numberRow = rows.find(row => row[characteristic] === "Neighbourhood Number");
const densityRow = rows.find(row => row[characteristic] === "Population density per square kilometre");
if (!numberRow || !densityRow) throw new Error("Neighbourhood profile rows not found");
const cityDensity = Number(densityRow[header.indexOf("City of Toronto")].replace(/,/g, ""));
const densityByNumber = new Map<number, { name: string; perKm2: number }>();
for (let column = characteristic + 2; column < header.length; column++) {
  const number = Number(numberRow[column]);
  const perKm2 = Number(densityRow[column].replace(/,/g, ""));
  if (Number.isFinite(number) && perKm2 > 0) densityByNumber.set(number, { name: header[column], perKm2 });
}

type Area = { name: string; perKm2: number; geometry: Polygon | MultiPolygon; box: [number, number, number, number] };
const areas: Area[] = [];
for (const feature of (JSON.parse(boundariesText) as FeatureCollection<Polygon | MultiPolygon, { AREA_SHORT_CODE: string }>).features) {
  const density = densityByNumber.get(Number(feature.properties.AREA_SHORT_CODE));
  if (!density) continue;
  const points = (feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates).flat(2);
  const box: Area["box"] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) { box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y); box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y); }
  areas.push({ ...density, geometry: feature.geometry, box });
}
if (areas.length < 130) throw new Error(`Only ${areas.length} neighbourhoods matched profile data`);

const data = JSON.parse(trafficText) as TrafficData;
let adjusted = 0;
for (const segment of data.segments) {
  const source = segment.source;
  if (source.kind !== "class" || source.localDensity || !SCALED_CLASSES.has(segment.cls)) continue;
  const [x, y] = segment.coords[Math.floor(segment.coords.length / 2)];
  const area = areas.find(a => x >= a.box[0] && x <= a.box[2] && y >= a.box[1] && y <= a.box[3] && isPointInBoundary([x, y], a.geometry));
  if (!area) continue;
  const factor = Math.min(LIMITS[1], Math.max(LIMITS[0], (area.perKm2 / cityDensity) ** ELASTICITY));
  segment.weekdayDaily = Math.round(segment.weekdayDaily * factor);
  segment.weekendDaily = Math.round(segment.weekendDaily * factor);
  source.localDensity = { neighbourhood: area.name, perKm2: area.perKm2, factor: Number(factor.toFixed(3)) };
  adjusted++;
}
data.meta.localDensity = { year: 2016, cityPerKm2: cityDensity, elasticity: ELASTICITY, limits: LIMITS, source: "https://open.toronto.ca/dataset/neighbourhood-profiles/" };
await writeFile("public/data/traffic.json", JSON.stringify(data));
console.log(`Scaled ${adjusted} uncounted local/collector segments by neighbourhood density (city ${cityDensity}/km²)`);
