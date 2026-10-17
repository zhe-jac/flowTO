import type { Disruption } from "../disruptions";
import type { Impact } from "./rerouting";

/** Simulated minutes for a disruption's effect to build to full strength after it starts. */
export const BUILD_UP_MINUTES = 45;

const clockMinutes = (value: string) => {
  const match = value.match(/T(\d{2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * When a disruption applies on the typical-day clock: its scheduled times when set, otherwise from the simulator time
 * it was placed until the end of the day. Returns minutes after midnight; `end` may be below `start` for overnight.
 */
export function disruptionWindow(item: Disruption, placedAt: number) {
  const start = clockMinutes(item.startsAt);
  const end = clockMinutes(item.endsAt);
  if (start !== null && end !== null) return { start, end, scheduled: true };
  return { start: placedAt, end: 1440, scheduled: false };
}

/** 0 before the disruption starts or after it ends, building from 0 to 1 over BUILD_UP_MINUTES after the start. */
export function disruptionStrength(item: Disruption, placedAt: number, minutes: number) {
  const { start, end } = disruptionWindow(item, placedAt);
  const m = ((minutes % 1440) + 1440) % 1440;
  const sinceStart = end > start ? m - start : (m - start + 1440) % 1440;
  const length = end > start ? end - start : end + 1440 - start;
  if (sinceStart < 0 || sinceStart >= length) return 0;
  // A tiny floor keeps a just-started disruption active (its closure applies) before congestion has built up.
  return Math.max(0.001, Math.min(1, sinceStart / BUILD_UP_MINUTES));
}

/** Scales a rerouting impact between none (0) and the full plan (1). */
export function scaleImpact(impact: Impact, strength: number): Impact {
  return {
    addedHourly: impact.addedHourly * strength,
    retained: 1 - (1 - impact.retained) * strength,
    capacityScale: 1 - (1 - impact.capacityScale) * strength,
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
