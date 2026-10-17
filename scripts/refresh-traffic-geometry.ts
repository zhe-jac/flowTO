import { readFile, writeFile } from "node:fs/promises";
import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import { restoreTrafficGeometry } from "../src/lib/traffic/geometry";
import type { TrafficData } from "../src/lib/traffic/types";

const [trafficText, sourceText] = await Promise.all([
  readFile("public/data/traffic.json", "utf8"),
  readFile("data/raw/centreline.geojson", "utf8"),
]);
const traffic = JSON.parse(trafficText) as TrafficData;
const source = JSON.parse(sourceText) as FeatureCollection<LineString | MultiLineString>;
const next = restoreTrafficGeometry(traffic, source);
const vertices = (data: TrafficData) => data.segments.reduce((sum, segment) => sum + segment.coords.length * (segment.oneway === 0 ? 2 : 1), 0);
await writeFile("public/data/traffic.json", JSON.stringify(next));
console.log(`Updated geometry for ${next.segments.length} traffic segments. Directional vertices: ${vertices(traffic)} → ${vertices(next)}.`);
