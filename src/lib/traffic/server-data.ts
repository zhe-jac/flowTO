import { readFile } from "node:fs/promises";
import { enrichTrafficData, VENUES, EMPLOYMENT_HUBS } from "./activity";
import type { RoadCollection } from "../types";
import { createStreetExtentResolver } from "./street-extent";
import type { TrafficData } from "./types";
let cached: Promise<TrafficData> | undefined;
export function trafficData() {
  return cached ??= readFile(`${process.cwd()}/public/data/traffic.json`, "utf8")
    .then(text => enrichTrafficData(JSON.parse(text)));
}

let streets: Promise<ReturnType<typeof createStreetExtentResolver>> | undefined;
export function placementStreets() {
  return streets ??= Promise.all([readFile(`${process.cwd()}/public/data/downtown-roads.geojson`, "utf8"), trafficData()])
    .then(([text, data]) => createStreetExtentResolver((JSON.parse(text) as RoadCollection).features, { knownNames: [...new Set(data.segments.map(road => road.name))], landmarks: [...VENUES, ...EMPLOYMENT_HUBS] }));
}
