import type { CongestionLevel } from "./model";

type Rgb = [number, number, number];

export const LEVEL_COLORS: Record<CongestionLevel, { road: Rgb; vehicle: Rgb; css: string }> = {
  free: { road: [87, 155, 198], vehicle: [53, 120, 164], css: "#579bc6" },
  moderate: { road: [212, 173, 89], vehicle: [170, 129, 46], css: "#d4ad59" },
  heavy: { road: [223, 152, 124], vehicle: [184, 108, 82], css: "#df987c" },
  severe: { road: [213, 107, 116], vehicle: [173, 69, 81], css: "#d56b74" },
};

export const CLASS_WIDTHS: Record<string, number> = {
  Expressway: 6.5,
  "Expressway Ramp": 4,
  "Major Arterial": 4.6,
  "Major Arterial Ramp": 3.6,
  "Minor Arterial": 4,
  "Minor Arterial Ramp": 3.2,
  Collector: 3.2,
  "Collector Ramp": 2.8,
  Local: 2.2,
};
