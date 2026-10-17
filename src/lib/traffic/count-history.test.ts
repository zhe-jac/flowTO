import assert from "node:assert/strict";
import { test } from "node:test";
import { factorFor, mergeCounts, yearFactors, type HistoricalCount } from "./count-history";

test("year factors come from locations counted both recently and earlier", () => {
  const history = new Map<string, HistoricalCount[]>();
  for (let i = 0; i < 80; i++) history.set(`a${i}`, [{ year: 2013, weekday: 1000 }, { year: 2024, weekday: 1200 }]);
  const factors = yearFactors(history);
  assert.equal(factors.get(2013), 1.2);
  assert.equal(factorFor(2013, factors), 1.2);
  assert.equal(factorFor(2025, factors), 1);
  assert.equal(factorFor(1990, factors), factors.get(Math.min(...factors.keys())));
});

test("factors are clamped so outliers cannot swing volumes wildly", () => {
  const history = new Map<string, HistoricalCount[]>();
  for (let i = 0; i < 80; i++) history.set(`a${i}`, [{ year: 2010, weekday: 100 }, { year: 2023, weekday: 1000 }]);
  assert.equal(yearFactors(history).get(2010), 1.4);
});

test("merging favours recent counts and reports the adjustment", () => {
  const factors = new Map([[2013, 1.2]]);
  const merged = mergeCounts([{ year: 2013, weekday: 1000 }, { year: 2023, weekday: 1300, weekend: 900 }], factors)!;
  assert.equal(merged.counts, 2);
  assert.equal(merged.firstYear, 2013);
  assert.equal(merged.lastYear, 2023);
  assert.ok(merged.weekday > 1200 && merged.weekday < 1300);
  assert.equal(merged.weekend, 900);
  const old = mergeCounts([{ year: 2013, weekday: 1000 }], factors)!;
  assert.equal(old.weekday, 1200);
  assert.ok(Math.abs(old.adjustment - 1.2) < 1e-9);
});
