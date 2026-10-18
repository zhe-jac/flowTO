import { readFile } from "node:fs/promises";
import { enrichTrafficData } from "./activity";
import type { TrafficData } from "./types";
let cached: Promise<TrafficData> | undefined;
export function trafficData() {
  return cached ??= readFile(`${process.cwd()}/public/data/traffic.json`, "utf8")
    .then(text => enrichTrafficData(JSON.parse(text)));
}
