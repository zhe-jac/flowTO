import { LEVELS, type CongestionLevel } from "./model";

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

export function congestionColor(position: number, vivid = false): Rgb {
  const value = Number.isNaN(position) ? 0 : Math.max(0, Math.min(LEVELS.length - 1, position));
  const low = Math.floor(value), high = Math.min(LEVELS.length - 1, low + 1);
  const t = value - low;
  const a = vivid ? VIVID_COLORS[LEVELS[low].id] : LEVEL_COLORS[LEVELS[low].id].road;
  const b = vivid ? VIVID_COLORS[LEVELS[high].id] : LEVEL_COLORS[LEVELS[high].id].road;
  return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
}
