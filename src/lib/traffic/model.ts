import { CLASS_ASSUMPTIONS, type DayType, type TrafficSegment } from "./types";

export type CongestionLevel = "free" | "moderate" | "heavy" | "severe";

export const LEVELS: { id: CongestionLevel; label: string; minRatio: number }[] = [
  { id: "free", label: "Flowing freely", minRatio: 0 },
  { id: "moderate", label: "Moderate", minRatio: 0.5 },
  { id: "heavy", label: "Heavy", minRatio: 0.75 },
  { id: "severe", label: "Stop-and-go", minRatio: 0.92 },
];

export type DirectionState = {
  /** Vehicles per hour in one direction. */
  flow: number;
  capacity: number;
  /** Volume divided by capacity. */
  ratio: number;
  speedKmh: number;
  level: CongestionLevel;
};

export const MINUTES_PER_DAY = 1440;

/** Share of daily traffic per 15 minutes at a time of day, interpolated between bin centres. */
export function profileShare(profile: number[], minutes: number) {
  const position = (((minutes - 7.5) / 15) % 96 + 96) % 96;
  const index = Math.floor(position);
  const t = position - index;
  return profile[index] * (1 - t) + profile[(index + 1) % 96] * t;
}

export function levelFor(ratio: number): CongestionLevel {
  let level: CongestionLevel = "free";
  for (const item of LEVELS) if (ratio >= item.minRatio) level = item.id;
  return level;
}

export function capacityPerDirection(segment: Pick<TrafficSegment, "cls" | "oneway">) {
  const assumption = CLASS_ASSUMPTIONS[segment.cls] ?? CLASS_ASSUMPTIONS.Local;
  return (segment.oneway === 0 ? assumption.lanes : assumption.onewayLanes) * assumption.laneCapacity;
}

/** BPR link performance function used in transportation planning: t = t0 · (1 + 0.15 · (v/c)^4). */
export function congestedSpeed(freeSpeedKmh: number, ratio: number) {
  return Math.max(4, freeSpeedKmh / (1 + 0.15 * ratio ** 4));
}

export function directionState(segment: Pick<TrafficSegment, "cls" | "oneway" | "weekdayDaily" | "weekendDaily">, share: number, day: DayType = "weekday"): DirectionState {
  const daily = day === "weekday" ? segment.weekdayDaily : segment.weekendDaily;
  const hourly = daily * share * 4;
  const flow = segment.oneway === 0 ? hourly / 2 : hourly;
  const capacity = capacityPerDirection(segment);
  const ratio = flow / capacity;
  const assumption = CLASS_ASSUMPTIONS[segment.cls] ?? CLASS_ASSUMPTIONS.Local;
  return { flow, capacity, ratio, speedKmh: congestedSpeed(assumption.freeSpeedKmh, ratio), level: levelFor(ratio) };
}

/** Vehicles on the segment at once (all directions), from density = flow / speed. */
export function vehiclesOnRoad(segment: Pick<TrafficSegment, "cls" | "oneway" | "weekdayDaily" | "weekendDaily" | "lengthM">, share: number, day: DayType = "weekday") {
  const state = directionState(segment, share, day);
  const perDirection = (state.flow / state.speedKmh) * (segment.lengthM / 1000);
  return perDirection * (segment.oneway === 0 ? 2 : 1);
}

export function formatClock(minutes: number) {
  const whole = Math.floor(((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  const hour = Math.floor(whole / 60);
  const minute = whole % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

const COMPASS = ["Northbound", "Eastbound", "Southbound", "Westbound"];
export function travelDirection(from: number[], to: number[]) {
  const dx = (to[0] - from[0]) * Math.cos((from[1] * Math.PI) / 180);
  const dy = to[1] - from[1];
  const degrees = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 90) % 4];
}
