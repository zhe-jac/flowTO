import { Worker } from "node:worker_threads";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SimulationInput, SimulationJob, SimulationResult } from "./simulation-types";

type Job = SimulationJob & { key: string; created: number; worker?: Worker };
const globalJobs = globalThis as typeof globalThis & { trafficSimulationJobs?: Map<string, Job> };
const jobs = globalJobs.trafficSimulationJobs ??= new Map<string, Job>();
let topology: Promise<Record<string, [string, string]>> | undefined;
export const trafficTopology = () => topology ??= readFile(path.join(process.cwd(), "public/data/traffic-topology.json"), "utf8").then(JSON.parse);

export function startSimulation(input: SimulationInput): SimulationJob {
  const key = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  for (const [id, job] of jobs) {
    if (Date.now() - job.created > 10 * 60 * 1000 && job.status !== "running") jobs.delete(id);
    else if (job.key === key && job.status !== "failed") return publicJob(job);
  }
  if ([...jobs.values()].filter(j => j.status === "running").length >= 2) throw new Error("Simulation workers are busy. Retry shortly.");
  while (jobs.size >= 6) {
    const oldest = [...jobs.values()].find(j => j.status !== "running");
    if (!oldest) break;
    jobs.delete(oldest.id);
  }
  const worker = new Worker(path.join(process.cwd(), "src/lib/traffic/simulation-worker.mjs"), { workerData: input });
  const job: Job = { id: randomUUID(), key, status: "running", created: Date.now(), worker };
  jobs.set(job.id, job);
  const timeout = setTimeout(() => { job.status = "failed"; job.error = "This simulation exceeded its processing budget. Try a smaller area."; void worker.terminate(); }, 45000);
  worker.once("message", ({ result, error }: { result?: SimulationResult; error?: string }) => {
    clearTimeout(timeout);
    if (job.status !== "running") return;
    job.status = result ? "complete" : "failed";
    job.result = result;
    job.error = error;
    delete job.worker;
  });
  worker.once("error", () => { clearTimeout(timeout); job.status = "failed"; job.error = "The local simulation worker could not run."; delete job.worker; });
  worker.once("exit", code => { clearTimeout(timeout); if (job.status === "running") { job.status = "failed"; job.error = `Simulation worker stopped (${code}).`; } delete job.worker; });
  return publicJob(job);
}

function publicJob(job: Job): SimulationJob {
  return { id: job.id, status: job.status, error: job.error, ...(job.status === "complete" ? { result: job.result } : {}) };
}
export function simulationJob(id: string) { const job = jobs.get(id); return job ? publicJob(job) : null; }
