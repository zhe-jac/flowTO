import { createHash, randomUUID } from "node:crypto";
import type { SimulationInput, SimulationJob, SimulationResult } from "./simulation-types";

export type SimulationOwner = { clientId: string; revision: number };
export function parseSimulationOwner(value: unknown): SimulationOwner {
  const owner = value as Partial<SimulationOwner> | null;
  if (!owner || typeof owner.clientId !== "string" || !/^[a-zA-Z0-9-]{16,80}$/.test(owner.clientId) || !Number.isSafeInteger(owner.revision) || owner.revision! < 1) throw new Error("Invalid simulation request identifier.");
  return { clientId: owner.clientId, revision: owner.revision! };
}

type Client = SimulationOwner & { active: boolean; updated: number; jobId?: string };
type SimulationWorker = {
  once(event: "message", listener: (message: { result?: SimulationResult; error?: string }) => void): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "exit", listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
};
type Job = SimulationJob & { key: string; created: number; input?: SimulationInput; owners: Set<string>; unowned: boolean; worker?: SimulationWorker };

export class SimulationQueue {
  private jobs = new Map<string, Job>();
  private clients = new Map<string, Client>();
  private running = 0;

  constructor(private createWorker: (input: SimulationInput) => SimulationWorker, private budgetMs = 45000) {}

  begin(owner: SimulationOwner) {
    this.prune();
    const previous = this.clients.get(owner.clientId);
    if (previous && (previous.revision > owner.revision || previous.revision === owner.revision && !previous.active)) return false;
    if (previous?.revision === owner.revision) return true;
    if (previous) this.release(previous);
    this.clients.set(owner.clientId, { ...owner, active: true, updated: Date.now() });
    return true;
  }

  cancel(owner: SimulationOwner) {
    const previous = this.clients.get(owner.clientId);
    if (previous && previous.revision > owner.revision) return;
    if (previous) this.release(previous);
    this.clients.set(owner.clientId, { ...owner, active: false, updated: Date.now() });
  }

  start(input: SimulationInput, owner?: SimulationOwner): SimulationJob {
    this.prune();
    const client = owner ? this.clients.get(owner.clientId) : undefined;
    if (owner && (!client?.active || client.revision !== owner.revision)) throw new Error("Simulation request was superseded.");
    const key = createHash("sha256").update("finite-storage-v2").update(JSON.stringify(input)).digest("hex");
    let job = [...this.jobs.values()].find(candidate => candidate.key === key && candidate.status !== "failed");
    if (!job) {
      if ([...this.jobs.values()].filter(candidate => candidate.status === "queued").length >= 12) throw new Error("Simulation workers are busy. Retry shortly.");
      job = { id: randomUUID(), key, status: "queued", created: Date.now(), input, owners: new Set(), unowned: !owner };
      this.jobs.set(job.id, job);
    }
    if (client) {
      client.jobId = job.id;
      job.owners.add(client.clientId);
    } else job.unowned = true;
    this.pump();
    return this.publicJob(job);
  }

  get(id: string): SimulationJob | null {
    const job = this.jobs.get(id);
    return job ? this.publicJob(job) : null;
  }

  private release(client: Client) {
    const job = client.jobId ? this.jobs.get(client.jobId) : undefined;
    if (!job) return;
    job.owners.delete(client.clientId);
    if (job.owners.size || job.unowned || job.status === "complete" || job.status === "failed") return;
    job.status = "failed";
    job.error = "Simulation request was superseded.";
    delete job.input;
    if (job.worker) void job.worker.terminate();
  }

  private prune() {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [id, client] of this.clients) {
      if (client.updated < cutoff) {
        this.release(client);
        this.clients.delete(id);
      }
    }
    const finished = [...this.jobs.values()].filter(job => !job.worker && job.status !== "queued");
    let retained = finished.length;
    for (const job of finished) {
      if (job.created < cutoff || retained > 6) {
        this.jobs.delete(job.id);
        retained--;
      }
    }
  }

  private pump() {
    while (this.running < 2) {
      const job = [...this.jobs.values()].find(candidate => candidate.status === "queued");
      if (!job?.input) return;
      try {
        const worker = this.createWorker(job.input);
        job.worker = worker;
        delete job.input;
        job.status = "running";
        this.running++;
        const timeout = setTimeout(() => {
          if (job.status === "running") {
            job.status = "failed";
            job.error = "This simulation exceeded its processing budget. Try a smaller area.";
          }
          void worker.terminate();
        }, this.budgetMs);
        worker.once("message", ({ result, error }: { result?: SimulationResult; error?: string }) => {
          if (job.status !== "running") return;
          job.status = result ? "complete" : "failed";
          job.result = result;
          job.error = error;
          void worker.terminate();
        });
        worker.once("error", () => {
          if (job.status !== "running") return;
          job.status = "failed";
          job.error = "The local simulation worker could not run.";
          void worker.terminate();
        });
        worker.once("exit", code => {
          clearTimeout(timeout);
          if (job.status === "running") {
            job.status = "failed";
            job.error = `Simulation worker stopped (${code}).`;
          }
          delete job.worker;
          this.running--;
          this.pump();
        });
      } catch {
        job.status = "failed";
        job.error = "The local simulation worker could not start.";
        delete job.input;
      }
    }
  }

  private publicJob(job: Job): SimulationJob {
    return { id: job.id, status: job.status, error: job.error, ...(job.status === "complete" ? { result: job.result } : {}) };
  }
}
