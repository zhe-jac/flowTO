import type { SimulationJob, SimulationResult } from "./simulation-types";

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function requestSimulation(body: string, signal: AbortSignal, send: typeof fetch = fetch): Promise<SimulationResult> {
  let id: string | undefined;
  let busySince: number | undefined;
  let expired = 0;
  while (!signal.aborted) {
    const response = await send(id ? `/api/traffic/simulations/${encodeURIComponent(id)}` : "/api/traffic/simulations", id ? { signal, cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body, signal });
    const job = await response.json() as SimulationJob;
    signal.throwIfAborted();
    if (response.status === 429) {
      busySince ??= Date.now();
      if (Date.now() - busySince >= 60000) throw new Error(job.error ?? "Traffic simulation is still busy. Please retry.");
      const seconds = Number(response.headers.get("Retry-After") ?? 1);
      await pause(Number.isFinite(seconds) ? Math.max(500, Math.min(5000, seconds * 1000)) : 1000, signal);
      continue;
    }
    if (response.status === 404 && id && expired++ < 2) { id = undefined; continue; }
    if (!response.ok || job.status === "failed") throw new Error(job.error ?? "Traffic simulation failed. Please retry.");
    if (job.status === "complete" && job.result) return job.result;
    id = job.id;
    await pause(500, signal);
  }
  signal.throwIfAborted();
  throw new Error("Traffic simulation was cancelled.");
}
