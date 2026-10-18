import type { DirectionState } from "./model";

type TrafficState = DirectionState & { queueVehicles?: number };

export function worsenedTraffic(before: TrafficState, after: TrafficState, previous = false) {
  const speedLoss = before.speedKmh - after.speedKmh;
  const extraQueue = (after.queueVehicles ?? 0) - (before.queueVehicles ?? 0);
  const minimumSpeedLoss = Math.max(previous ? 1 : 2, before.speedKmh * (previous ? 0.05 : 0.1));
  return speedLoss >= minimumSpeedLoss || extraQueue >= (previous ? 1 : 2);
}
