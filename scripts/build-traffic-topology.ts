import { readFile, writeFile } from "node:fs/promises";

const raw = JSON.parse(await readFile("data/raw/centreline.geojson", "utf8"));
const links: Record<string, [string, string]> = {};
for (const feature of raw.features) {
  const p = feature.properties;
  if (!p?.CENTRELINE_ID || !p.FROM_INTERSECTION_ID || !p.TO_INTERSECTION_ID) continue;
  const parts = feature.geometry?.coordinates?.filter((part: number[][]) => part.length > 1) ?? [];
  for (let i = 0; i < parts.length; i++) links[parts.length === 1 ? String(p.CENTRELINE_ID) : `${p.CENTRELINE_ID}:${i}`] = [String(p.FROM_INTERSECTION_ID), String(p.TO_INTERSECTION_ID)];
}
await writeFile("public/data/traffic-topology.json", JSON.stringify(links));
console.log(`Saved ${Object.keys(links).length} road junction pairs.`);
