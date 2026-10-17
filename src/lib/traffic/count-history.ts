/**
 * Brings old traffic counts up to recent levels. The City recounts each location only every few years, so a segment's
 * latest count may be a decade old. Locations counted both recently and in an earlier year show how volumes changed;
 * the median of those ratios, pooled over neighbouring years, gives an adjustment factor per count year.
 */

export const RECENT_FROM_YEAR = 2022;
/** Counts older than this many years before a location's latest count are not merged. */
const MERGE_WINDOW_YEARS = 12;
/** Each additional five years of age halves a count's weight when merging. */
const HALF_LIFE_YEARS = 5;
const MIN_SAMPLES = 60;
const MAX_POOL_RADIUS = 4;
const FACTOR_LIMITS: [number, number] = [0.8, 1.4];

export type HistoricalCount = { year: number; weekday: number; weekend?: number };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Factor per count year that scales a count from that year to recent (2022+) levels. Recent years are 1. */
export function yearFactors(history: Map<string, HistoricalCount[]>): Map<number, number> {
  const ratiosByYear = new Map<number, number[]>();
  for (const counts of history.values()) {
    const recent = counts.filter((count) => count.year >= RECENT_FROM_YEAR).map((count) => count.weekday);
    if (!recent.length) continue;
    const reference = median(recent);
    for (const count of counts) {
      if (count.year >= RECENT_FROM_YEAR) continue;
      if (!ratiosByYear.has(count.year)) ratiosByYear.set(count.year, []);
      ratiosByYear.get(count.year)!.push(reference / count.weekday);
    }
  }
  const factors = new Map<number, number>();
  const years = [...ratiosByYear.keys()];
  const first = Math.min(...years, RECENT_FROM_YEAR);
  for (let year = first; year < RECENT_FROM_YEAR; year++) {
    // Widen the pool of neighbouring years until there are enough paired locations for a stable median.
    let pool: number[] = [];
    for (let radius = 0; radius <= MAX_POOL_RADIUS && pool.length < MIN_SAMPLES; radius++) {
      pool = [];
      for (let y = year - radius; y <= year + radius; y++) pool.push(...(ratiosByYear.get(y) ?? []));
    }
    if (pool.length < MIN_SAMPLES / 3) continue;
    factors.set(year, Math.min(FACTOR_LIMITS[1], Math.max(FACTOR_LIMITS[0], median(pool))));
  }
  return factors;
}

export function factorFor(year: number, factors: Map<number, number>) {
  if (year >= RECENT_FROM_YEAR) return 1;
  if (factors.has(year)) return factors.get(year)!;
  const known = [...factors.keys()].sort((a, b) => a - b);
  if (!known.length) return 1;
  return factors.get(year < known[0] ? known[0] : known[known.length - 1])!;
}

export type MergedCount = {
  weekday: number;
  weekend: number | null;
  counts: number;
  firstYear: number;
  lastYear: number;
  /** Merged, adjusted volume divided by the latest raw count. */
  adjustment: number;
};

/** Combines a location's counts from different years, each adjusted to recent levels and weighted towards newer counts. */
export function mergeCounts(counts: HistoricalCount[], factors: Map<number, number>): MergedCount | null {
  const valid = counts.filter((count) => count.weekday > 0);
  if (!valid.length) return null;
  const lastYear = Math.max(...valid.map((count) => count.year));
  const used = valid.filter((count) => count.year >= lastYear - MERGE_WINDOW_YEARS);
  let weekdaySum = 0;
  let weekdayWeight = 0;
  let weekendSum = 0;
  let weekendWeight = 0;
  for (const count of used) {
    const weight = 0.5 ** ((lastYear - count.year) / HALF_LIFE_YEARS);
    const factor = factorFor(count.year, factors);
    weekdaySum += count.weekday * factor * weight;
    weekdayWeight += weight;
    if (count.weekend && count.weekend > 0) {
      weekendSum += count.weekend * factor * weight;
      weekendWeight += weight;
    }
  }
  const latest = used.filter((count) => count.year === lastYear).reduce((sum, count, _, list) => sum + count.weekday / list.length, 0);
  const weekday = weekdaySum / weekdayWeight;
  return {
    weekday,
    weekend: weekendWeight ? weekendSum / weekendWeight : null,
    counts: used.length,
    firstYear: Math.min(...used.map((count) => count.year)),
    lastYear,
    adjustment: weekday / latest,
  };
}
