import { mkdir, readFile, writeFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { read } from "shapefile";
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

const packageUrl = "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=regional-municipal-boundary";
const cachePath = "data/raw/toronto-boundary.zip";
await mkdir("data/raw", { recursive: true });
await mkdir("src/lib/data", { recursive: true });
await mkdir("public/data", { recursive: true });
let archive: Uint8Array;
try {
  archive = await readFile(cachePath);
} catch {
  const response = await fetch(packageUrl);
  if (!response.ok) throw new Error(`Boundary metadata request failed: ${response.status}`);
  const metadata = await response.json();
  const resource = metadata.result.resources.find((item: { name: string }) => item.name === "toronto-boundary-wgs84");
  if (!resource) throw new Error("Official WGS84 city boundary resource was not found");
  const download = await fetch(resource.url);
  if (!download.ok) throw new Error(`Boundary download failed: ${download.status}`);
  archive = new Uint8Array(await download.arrayBuffer());
  await writeFile(cachePath, archive);
}

const files = unzipSync(archive);
const shpName = Object.keys(files).find((name) => name.endsWith(".shp"));
const dbfName = Object.keys(files).find((name) => name.endsWith(".dbf"));
if (!shpName || !dbfName) throw new Error("Boundary archive is missing geometry or attributes");
const collection = await read(files[shpName], files[dbfName]);
const polygons: Position[][][] = [];
const area = (ring: Position[]) => ring.slice(1).reduce((sum, point, index) => sum + ring[index][0] * point[1] - point[0] * ring[index][1], 0);
for (const feature of collection.features) {
  if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) continue;
  const geometry = feature.geometry as Polygon | MultiPolygon;
  const parts = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of parts) {
    polygons.push(polygon.map((ring, index) => {
      const rounded = ring.map((point) => point.slice(0, 2).map((value) => Math.round(value * 1e6) / 1e6));
      const isCounterClockwise = area(rounded) > 0;
      return isCounterClockwise === (index === 0) ? rounded : rounded.reverse();
    }));
  }
}
if (!polygons.length) throw new Error("No polygons found in the official boundary");

const boundary: Feature<MultiPolygon> = {
  type: "Feature",
  properties: {
    name: "City of Toronto",
    source: "City of Toronto Regional Municipal Boundary",
    sourceUrl: "https://open.toronto.ca/dataset/regional-municipal-boundary/",
    licence: "Open Government Licence – Toronto",
  },
  geometry: { type: "MultiPolygon", coordinates: polygons },
};
const points = polygons.flat(2);
const bounds = points.reduce((result, point) => [Math.min(result[0], point[0]), Math.min(result[1], point[1]), Math.max(result[2], point[0]), Math.max(result[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity]);
await writeFile("src/lib/data/toronto-boundary.json", JSON.stringify(boundary));
await writeFile("public/data/toronto-boundary-metadata.json", JSON.stringify({ ...boundary.properties, datasetApi: packageUrl, builtAt: new Date().toISOString(), bounds, polygons: polygons.length, vertices: points.length }, null, 2));
console.log(JSON.stringify({ bounds, polygons: polygons.length, vertices: points.length }));
