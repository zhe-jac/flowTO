import { parentPort, workerData } from "node:worker_threads";
import { simulateNetwork } from "./simulation-engine.mjs";
try {
  parentPort.postMessage({ result: simulateNetwork(workerData) });
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : "Simulation failed." });
}
