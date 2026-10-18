import { DRY_WEATHER, type WeatherRates } from "../weather";
import { weatherFactors } from "./weather";
import { activityFactor, type ActivityContext, type RoadActivity } from "./activity";
import { CLASS_ASSUMPTIONS, type DayType, type TrafficSegment } from "./types";
export type CongestionLevel = "free" | "moderate" | "heavy" | "severe";
export const LEVELS: {
    id: CongestionLevel;
    label: string;
    minRatio: number;
}[] = [
    { id: "free", label: "Flowing freely", minRatio: 0 },
    { id: "moderate", label: "Moderate", minRatio: 0.5 },
    { id: "heavy", label: "Heavy", minRatio: 0.75 },
    { id: "severe", label: "Stop-and-go", minRatio: 0.92 },
];
export type DirectionState = {
    flow: number;
    capacity: number;
    ratio: number;
    speedKmh: number;
    freeSpeedKmh: number;
    level: CongestionLevel;
};
export const MINUTES_PER_DAY = 1440;
export function profileShare(profile: number[], minutes: number) {
    const position = (((minutes - 7.5) / 15) % 96 + 96) % 96;
    const index = Math.floor(position);
    const t = position - index;
    return profile[index] * (1 - t) + profile[(index + 1) % 96] * t;
}
export function levelFor(ratio: number): CongestionLevel {
    let level: CongestionLevel = "free";
    for (const item of LEVELS)
        if (ratio >= item.minRatio)
            level = item.id;
    return level;
}
export function congestionPosition(ratio: number) {
    if (!(ratio > 0)) return 0;
    for (let index = 1; index < LEVELS.length; index++) {
        const upper = LEVELS[index].minRatio;
        if (ratio > upper) continue;
        const lower = LEVELS[index - 1].minRatio;
        return index - 1 + (ratio - lower) / (upper - lower);
    }
    return LEVELS.length - 1;
}
export function capacityPerDirection(segment: Pick<TrafficSegment, "cls" | "oneway">) {
    const assumption = CLASS_ASSUMPTIONS[segment.cls] ?? CLASS_ASSUMPTIONS.Local;
    return (segment.oneway === 0 ? assumption.lanes : assumption.onewayLanes) * assumption.laneCapacity;
}
export function congestedSpeed(freeSpeedKmh: number, ratio: number) {
    return Math.max(4, freeSpeedKmh / (1 + 0.15 * ratio ** 4));
}
export function directionState(segment: Pick<TrafficSegment, "cls" | "oneway" | "weekdayDaily" | "weekendDaily"> & { activity?: RoadActivity }, share: number, day: DayType = "weekday", weather: WeatherRates = DRY_WEATHER, context?: ActivityContext): DirectionState {
    const daily = day === "weekday" ? segment.weekdayDaily : segment.weekendDaily;
    const hourly = daily * share * 4 * activityFactor(segment.activity, day, context);
    const flow = segment.oneway === 0 ? hourly / 2 : hourly;
    const factors = weatherFactors(segment.cls, weather);
    const capacity = capacityPerDirection(segment) * factors.capacity;
    const ratio = flow / capacity;
    const assumption = CLASS_ASSUMPTIONS[segment.cls] ?? CLASS_ASSUMPTIONS.Local;
    const freeSpeedKmh = assumption.freeSpeedKmh * factors.speed;
    return { flow, capacity, ratio, freeSpeedKmh, speedKmh: congestedSpeed(freeSpeedKmh, ratio), level: levelFor(ratio) };
}
export function vehiclesOnRoad(segment: Pick<TrafficSegment, "cls" | "oneway" | "weekdayDaily" | "weekendDaily" | "lengthM">, share: number, day: DayType = "weekday", weather: WeatherRates = DRY_WEATHER) {
    const state = directionState(segment, share, day, weather);
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
