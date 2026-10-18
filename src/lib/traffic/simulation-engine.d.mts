import type { SimulationEdge, SimulationInput, SimulationResult } from "./simulation-types";
export function inferTrips(edges: SimulationEdge[], nodeCount: number): { path: number[]; daily: number; origin: number; destination: number }[];
export function simulateNetwork(input: SimulationInput): SimulationResult;
export function movementLanes(edge: SimulationEdge, next?: SimulationEdge, count?: number): number[];
export function createRoutePlanner(edges: SimulationEdge[], nodeCount: number): { readonly version: number; update(costs: ArrayLike<number>, permissions: ArrayLike<number>): void; cost(path: number[]): number; route(origin: number, destination: number, options?: { previous?: number; visited?: number[]; lane?: number }): { path: number[]; cost: number } | null };
