import type { Disruption } from "../disruptions";
import type { Impact } from "./rerouting";

export const BUILD_UP_MINUTES = 45;
export type DisruptionPlacement = number | { date: string; minutes: number };
const calendarMinute = (value: string) => Date.parse(`${value}Z`) / 60000;
const clockMinutes = (value: string) => {
  const match = value.match(/T(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export function disruptionWindow(item: Disruption, placedAt: DisruptionPlacement, date?: string) {
  const start = clockMinutes(item.startsAt), end = clockMinutes(item.endsAt);
  if (start !== null && end !== null) {
    if (date) {
      const midnight = calendarMinute(`${date}T00:00:00`);
      return { start: calendarMinute(`${item.startsAt}:00`) - midnight, end: calendarMinute(`${item.endsAt}:00`) - midnight, scheduled: true };
    }
    return { start, end, scheduled: true };
  }
  const offset = typeof placedAt === "number" || !date ? 0 : calendarMinute(`${placedAt.date}T00:00:00`) - calendarMinute(`${date}T00:00:00`);
  return { start: offset + (typeof placedAt === "number" ? placedAt : placedAt.minutes), end: offset + 1440, scheduled: false };
}

export function disruptionStrength(item: Disruption, placedAt: DisruptionPlacement, minutes: number, date?: string) {
  const { start, end } = disruptionWindow(item, placedAt, date);
  const m = ((minutes % 1440) + 1440) % 1440;
  const sinceStart = date || end > start ? m - start : (m - start + 1440) % 1440;
  const length = date || end > start ? end - start : end + 1440 - start;
  if (sinceStart < 0 || sinceStart >= length) return 0;
  return item.kind === "event" ? Math.max(0.001, Math.min(1, sinceStart / BUILD_UP_MINUTES)) : 1;
}

export function scaleImpact(impact: Impact, strength: number): Impact {
  return {
    addedHourly: impact.addedHourly * strength,
    retained: 1 - (1 - impact.retained) * strength,
    capacityScale: 1 - (1 - impact.capacityScale) * strength,
    ...(impact.addedByDirection ? { addedByDirection: impact.addedByDirection.map(value => value * strength) as [number, number] } : {}),
  };
}

/** Splits a path into pieces of at most `pieceMetres`, so colour can sweep along a road instead of changing at once. */
export function splitPath(path: [number, number][], pieceMetres: number): [number, number][][] {
  const pieces: [number, number][][] = [];
  let current: [number, number][] = [path[0]];
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    let from = path[i - 1];
    const to = path[i];
    let span = Math.hypot((to[0] - from[0]) * 80400, (to[1] - from[1]) * 111200);
    while (length + span > pieceMetres && span > 0) {
      const t = (pieceMetres - length) / span;
      const cut: [number, number] = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      current.push(cut);
      pieces.push(current);
      current = [cut];
      span -= pieceMetres - length;
      from = cut;
      length = 0;
    }
    current.push(to);
    length += span;
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

/**
 * Level index (0 free … 3 stop-and-go, fractional while blending) of a point on the impact wave. Each level step is its
 * own front that sweeps from the disruption (`reach` 0) to the far end (`reach` 1), so a road turns yellow along its
 * length first, then red behind it.
 */
export function waveLevel(from: number, to: number, elapsed: number, reach: number, timing: { sweep: number; gap: number; blend: number }) {
  const steps = Math.abs(to - from);
  const direction = Math.sign(to - from);
  let value = from;
  for (let step = 0; step < steps; step++) {
    const arrival = step * timing.gap + reach * timing.sweep;
    const raw = Math.min(1, Math.max(0, (elapsed - arrival) / timing.blend));
    value += direction * raw * raw * (3 - 2 * raw);
  }
  return value;
}

export function waveDuration(steps: number, timing: { sweep: number; gap: number; blend: number }) {
  return Math.max(0, steps - 1) * timing.gap + timing.sweep + timing.blend;
}
