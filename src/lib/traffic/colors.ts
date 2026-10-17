import type { CongestionLevel } from "./model";

type Rgb = [number, number, number];

export const LEVEL_COLORS: Record<CongestionLevel, { road: Rgb; vehicle: Rgb; css: string }> = {
  free: { road: [48, 164, 119], vehicle: [29, 126, 88], css: "#30a477" },
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

/** Saturated versions used to make roads affected by a scenario stand out from the rest. */
export const VIVID_COLORS: Record<CongestionLevel, Rgb> = {
  free: [0, 205, 128],
  moderate: [255, 200, 0],
  heavy: [255, 112, 0],
  severe: [255, 36, 48],
};
