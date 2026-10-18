import type { Disruption } from "../disruptions";
import type { WeatherRates } from "../weather";
import type { DirectionState } from "./model";

export type SimulatedState = DirectionState & { queueVehicles: number; vehicles: number; delaySeconds: number };
export type SimulationEdge = { id: string; direction: 1 | -1; from: number; to: number; length: number; speed: number; capacity: number; storage: number; daily: number; dailyByDay?: [number, number]; lanes: number };
export type SimulationOperation = { id: string; kind: Disruption["kind"]; edges: number[]; start: number; end: number; capacity: number; vehicles: number; destination?: number; origins?: number[] };
export type SimulationInput = { edges: SimulationEdge[]; nodeCount: number; profile: number[]; dayProfiles?: Record<string, number[]>; dayTypes?: Record<string, 0 | 1>; start: number; end: number; warmup: number; step: number; interval: number; operations: SimulationOperation[]; warnings: string[] };
export type SimulationLedger = { generated: number; completed: number; onNetwork: number; pending: number; balanceError: number; delayVehicleMinutes: number };
export type SimulationFrame = { minute: number; values: string; baseline: SimulationLedger; scenario: SimulationLedger; closed: string[]; capacityScales: Record<string, number> };
export type SimulationResult = { version: string; start: number; end: number; edges: SimulationEdge[]; operations: SimulationOperation[]; frames: SimulationFrame[]; warnings: string[]; diagnostics: { trips: number; elapsedMs: number; maxStorageError: number; maxBalanceError: number }; context: "observed-count estimates" };
export type SimulationRequest = { items: Disruption[]; date: string; minutes: number; weather: WeatherRates };
export type SimulationJob = { id: string; status: "running" | "complete" | "failed"; error?: string; result?: SimulationResult };
