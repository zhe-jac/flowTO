import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import type { Road, RoadProperties } from "../src/lib/types";

const datasetUrl = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=toronto-centreline-tcl";
const bounds = (process.env.MAP_BOUNDS ?? "-79.435,43.63,-79.345,43.685").split(",").map(Number);
if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value)) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
  throw new Error("MAP_BOUNDS must be west,south,east,north");
}
const cachePath = "data/raw/centreline.geojson";
await mkdir("data/raw", { recursive: true });
await mkdir("public/data", { recursive: true });
let raw: string;
try {
  raw = await readFile(cachePath, "utf8");
} catch {
  const response = await fetch(datasetUrl);
  if (!response.ok) throw new Error(`Dataset lookup failed: ${response.status}`);
  const metadata = await response.json();
  const resource = metadata.result.resources.find((item: { name: string }) => item.name.endsWith("4326.geojson"));
  if (!resource) throw new Error("No WGS84 GeoJSON resource found");
  const download = await fetch(resource.url);
  if (!download.ok) throw new Error(`Road download failed: ${download.status}`);
  raw = await download.text();
  await writeFile(cachePath, raw);
}

const input = JSON.parse(raw) as FeatureCollection<LineString | MultiLineString>;
const roads: Road[] = [];
const distance = (coordinates: number[][]) => coordinates.slice(1).reduce((total, point, index) => {
  const previous = coordinates[index];
  const radians = Math.PI / 180;
  const lat = (point[1] - previous[1]) * radians;
  const lon = (point[0] - previous[0]) * radians;
  const a = Math.sin(lat / 2) ** 2 + Math.cos(previous[1] * radians) * Math.cos(point[1] * radians) * Math.sin(lon / 2) ** 2;
  return total + 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}, 0);

for (const feature of input.features) {
  const properties = feature.properties;
  if (!properties || !/Expressway|Arterial|Collector|Local|Ramp/i.test(String(properties.FEATURE_CODE_DESC))) continue;
  if (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") continue;
  const parts = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  for (const [part, coordinates] of parts.entries()) {
    if (!coordinates.some(([lon, lat]) => lon >= bounds[0] && lon <= bounds[2] && lat >= bounds[1] && lat <= bounds[3])) continue;
    const sourceId = String(properties.CENTRELINE_ID);
    const id = parts.length === 1 ? sourceId : `${sourceId}:${part}`;
    const bucket = Number(properties.CENTRELINE_ID) % 13;
    const props: RoadProperties = {
      id,
      name: String(properties.LINEAR_NAME_FULL || "Unnamed road"),
      roadClass: String(properties.FEATURE_CODE_DESC),
      direction: String(properties.ONEWAY_DIR_CODE_DESC || "Direction not supplied"),
      lengthM: Math.round(distance(coordinates)),
      flow: bucket < 3 ? "slow" : bucket < 7 ? "moderate" : "clear",
    };
    roads.push({ type: "Feature", id, geometry: { type: "LineString", coordinates }, properties: props });
  }
}

await writeFile("public/data/downtown-roads.geojson", JSON.stringify({ type: "FeatureCollection", features: roads }));
await writeFile("public/data/roads-metadata.json", JSON.stringify({
  source: "City of Toronto Centreline",
  sourceUrl: "https://open.toronto.ca/dataset/toronto-centreline-tcl/",
  licence: "Open Government Licence – Toronto",
  builtAt: new Date().toISOString(),
  bounds,
  segmentCount: roads.length,
  traffic: "Illustrative values only. No traffic measurements or simulation.",
}, null, 2));
console.log(`Built ${roads.length} selectable road segments.`);
