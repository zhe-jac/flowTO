/** Daylight on the simulator clock: Toronto's real sunrise and sunset for a date, with dawn and dusk ramps between them. */

const LATITUDE = 43.6532;
const LONGITUDE = -79.3832;
const RAD = Math.PI / 180;
/** Minutes before sunrise / after sunset where the light starts and finishes changing. */
const TWILIGHT_OUTSIDE = 40;
/** Minutes after sunrise / before sunset where it is fully day. */
const TWILIGHT_INSIDE = 35;

export type LightPhase = "night" | "dawn" | "day" | "dusk";

export type SimulatorLight = {
  /** 0 is full night, 1 is full day, in steps of 0.05. */
  daylight: number;
  phase: LightPhase;
  /** Discrete theme for things that only have day and night styles. */
  theme: "day" | "night";
};

function torontoOffsetMinutes(date: Date) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: "America/Toronto", timeZoneName: "shortOffset" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? "GMT-5";
  const match = name.match(/GMT([+-]\d+)(?::(\d+))?/);
  if (!match) return -300;
  const hours = Number(match[1]);
  return hours * 60 + Math.sign(hours) * Number(match[2] ?? 0);
}

/** Sunrise and sunset in Toronto local minutes after midnight (NOAA solar position equations). */
export function sunTimes(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start) / 86400000) + 1;
  const g = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const equationOfTime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const declination = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosHourAngle = Math.cos(90.833 * RAD) / (Math.cos(LATITUDE * RAD) * Math.cos(declination)) - Math.tan(LATITUDE * RAD) * Math.tan(declination);
  const hourAngle = Math.acos(Math.min(1, Math.max(-1, cosHourAngle))) / RAD;
  const offset = torontoOffsetMinutes(date);
  return {
    sunrise: 720 - 4 * (LONGITUDE + hourAngle) - equationOfTime + offset,
    sunset: 720 - 4 * (LONGITUDE - hourAngle) - equationOfTime + offset,
  };
}

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

export function simulatorLight(minutes: number, date = new Date()): SimulatorLight {
  const m = ((minutes % 1440) + 1440) % 1440;
  const { sunrise, sunset } = sunTimes(date);
  const morning = smoothstep(sunrise - TWILIGHT_OUTSIDE, sunrise + TWILIGHT_INSIDE, m);
  const evening = 1 - smoothstep(sunset - TWILIGHT_INSIDE, sunset + TWILIGHT_OUTSIDE, m);
  const daylight = Math.round(Math.min(morning, evening) * 20) / 20;
  const phase: LightPhase = daylight <= 0.15 ? "night" : daylight >= 0.85 ? "day" : m < 720 ? "dawn" : "dusk";
  return { daylight, phase, theme: daylight >= 0.5 ? "day" : "night" };
}

type Rgba = [number, number, number, number];

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl() and hsla() colours; returns null for anything else. */
export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b, a = "f"] = digits.split("");
      return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16), parseInt(a + a, 16) / 255];
    }
    if (digits.length === 6 || digits.length === 8) {
      return [parseInt(digits.slice(0, 2), 16), parseInt(digits.slice(2, 4), 16), parseInt(digits.slice(4, 6), 16), digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1];
    }
    return null;
  }
  const fn = text.match(/^(rgba?|hsla?)\(([^)]+)\)$/);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean).map((part) => parseFloat(part));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const alpha = parts[3] === undefined ? 1 : fn[2].includes("%") && parts[3] > 1 ? parts[3] / 100 : parts[3];
  if (fn[1].startsWith("rgb")) return [parts[0], parts[1], parts[2], alpha];
  const [h, s, l] = [parts[0] / 360, parts[1] / 100, parts[2] / 100];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const u = ((t % 1) + 1) % 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255, alpha];
}

/** Night value at 0, day value at 1, blended colours between; values that are not colours switch halfway. */
export function blendValue<T>(night: T, day: T, t: number): T | string {
  if (t <= 0) return night;
  if (t >= 1) return day;
  return mixColor(night, day, t) ?? (t >= 0.5 ? day : night);
}

/** Blends two colours; `t` = 0 gives `night`, 1 gives `day`. Returns null when either colour cannot be parsed. */
export function mixColor(night: unknown, day: unknown, t: number): string | null {
  const a = parseColor(night);
  const b = parseColor(day);
  if (!a || !b) return null;
  const mix = (i: number) => a[i] + (b[i] - a[i]) * t;
  return `rgba(${Math.round(mix(0))}, ${Math.round(mix(1))}, ${Math.round(mix(2))}, ${Number(mix(3).toFixed(3))})`;
}
