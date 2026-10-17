export type DayType = "weekday" | "weekend";
export type VolumeSource = {
    kind: "midblock";
    label: string;
    date: string;
} | {
    kind: "intersection";
    label: string;
    date: string;
} | {
    kind: "street";
    label?: string;
    date?: string;
    distanceM: number;
} | {
    kind: "class";
    samples?: number;
};
export type TrafficSegment = {
    id: string;
    name: string;
    cls: string;
    oneway: 1 | -1 | 0;
    lengthM: number;
    weekdayDaily: number;
    weekendDaily: number;
    source: VolumeSource;
    coords: number[][];
};
export type TrafficData = {
    meta: {
        builtAt: string;
        bounds: number[];
        vehiclesPerDot: number;
        profileDays: Record<DayType, number>;
        sourceCounts: Record<VolumeSource["kind"], number>;
        sources: {
            name: string;
            url: string;
        }[];
        licence: string;
    };
    profiles: Record<DayType, number[]>;
    segments: TrafficSegment[];
};
export type ClassAssumption = {
    label: string;
    lanes: number;
    onewayLanes: number;
    laneCapacity: number;
    freeSpeedKmh: number;
    fallbackDaily: number;
};
export const CLASS_ASSUMPTIONS: Record<string, ClassAssumption> = {
    Expressway: { label: "Expressway", lanes: 3, onewayLanes: 3, laneCapacity: 1600, freeSpeedKmh: 90, fallbackDaily: 60000 },
    "Expressway Ramp": { label: "Expressway ramp", lanes: 1, onewayLanes: 1, laneCapacity: 1500, freeSpeedKmh: 50, fallbackDaily: 12000 },
    "Major Arterial": { label: "Major arterial", lanes: 2, onewayLanes: 3, laneCapacity: 600, freeSpeedKmh: 40, fallbackDaily: 20000 },
    "Major Arterial Ramp": { label: "Major arterial ramp", lanes: 1, onewayLanes: 1, laneCapacity: 900, freeSpeedKmh: 35, fallbackDaily: 8000 },
    "Minor Arterial": { label: "Minor arterial", lanes: 2, onewayLanes: 2, laneCapacity: 450, freeSpeedKmh: 35, fallbackDaily: 10000 },
    "Minor Arterial Ramp": { label: "Minor arterial ramp", lanes: 1, onewayLanes: 1, laneCapacity: 700, freeSpeedKmh: 30, fallbackDaily: 5000 },
    Collector: { label: "Collector", lanes: 1, onewayLanes: 2, laneCapacity: 500, freeSpeedKmh: 30, fallbackDaily: 4000 },
    "Collector Ramp": { label: "Collector ramp", lanes: 1, onewayLanes: 1, laneCapacity: 650, freeSpeedKmh: 30, fallbackDaily: 3000 },
    Local: { label: "Local street", lanes: 1, onewayLanes: 1, laneCapacity: 350, freeSpeedKmh: 25, fallbackDaily: 800 },
};
