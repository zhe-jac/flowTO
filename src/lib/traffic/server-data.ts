import { readFile } from "node:fs/promises";
import { enrichTrafficData } from "./activity";
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
  return streets ??= readFile(`${process.cwd()}/public/data/downtown-roads.geojson`, "utf8")
    .then(text => createStreetExtentResolver((JSON.parse(text) as RoadCollection).features));
}
