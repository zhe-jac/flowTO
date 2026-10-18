import type { SimulationEdge, SimulationInput, SimulationResult } from "./simulation-types";
export function inferTrips(edges: SimulationEdge[], nodeCount: number): { path: number[]; daily: number; origin: number; destination: number }[];
export function simulateNetwork(input: SimulationInput): SimulationResult;
