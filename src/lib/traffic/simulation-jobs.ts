import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SimulationQueue, type SimulationOwner } from "./simulation-queue";
import type { SimulationInput } from "./simulation-types";

const globalJobs = globalThis as typeof globalThis & { trafficSimulationQueue?: SimulationQueue };
const jobs = globalJobs.trafficSimulationQueue ??= new SimulationQueue(input => new Worker(path.join(process.cwd(), "src/lib/traffic/simulation-worker.mjs"), { workerData: input }));
let topology: Promise<Record<string, [string, string]>> | undefined;
export const trafficTopology = () => topology ??= readFile(path.join(process.cwd(), "public/data/traffic-topology.json"), "utf8").then(JSON.parse);
export const beginSimulation = (owner: SimulationOwner) => jobs.begin(owner);
export const cancelSimulation = (owner: SimulationOwner) => jobs.cancel(owner);
export const startSimulation = (input: SimulationInput, owner?: SimulationOwner) => jobs.start(input, owner);
export const simulationJob = (id: string) => jobs.get(id);
