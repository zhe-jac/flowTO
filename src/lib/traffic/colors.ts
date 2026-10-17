import type { CongestionLevel } from "./model";
type Rgb = [
    number,
    number,
    number
];
export const LEVEL_COLORS: Record<CongestionLevel, {
    road: Rgb;
    vehicle: Rgb;
    css: string;
}> = {
    free: { road: [52, 178, 124], vehicle: [16, 138, 92], css: "#1f9c6c" },
    moderate: { road: [236, 190, 52], vehicle: [207, 152, 8], css: "#d9a20f" },
    heavy: { road: [242, 132, 52], vehicle: [222, 100, 20], css: "#e06a1a" },
    severe: { road: [218, 60, 52], vehicle: [186, 30, 36], css: "#c42a2a" },
};
export const CLASS_WIDTHS: Record<string, number> = {
    Expressway: 11,
    "Expressway Ramp": 6,
    "Major Arterial": 8,
    "Major Arterial Ramp": 6,
    "Minor Arterial": 7,
    "Minor Arterial Ramp": 6,
    Collector: 5.5,
    "Collector Ramp": 5,
    Local: 3.5,
};
