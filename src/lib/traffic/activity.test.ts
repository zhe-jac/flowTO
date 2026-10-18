import assert from "node:assert/strict";
import { test } from "node:test";
import { activityFactor, enrichTrafficData, suppressedVenues, VENUE_EVENTS } from "./activity";
import type { TrafficData } from "./types";

test("employment peaks are local and weekday-only; measured totals are preserved", () => {
  const activity = { employment: 1, venues: [] };
  assert.ok(activityFactor(activity, "weekday", { minutes: 510 }) > activityFactor(activity, "weekday", { minutes: 100 }));
  assert.equal(activityFactor(activity, "weekend", { minutes: 510 }), 1);
  assert.equal(activityFactor(undefined, "weekday", { minutes: 510 }), 1);
  const data = { segments: [{ id: "test", coords: [[-79.381, 43.649]], weekdayDaily: 12345, weekendDaily: 6789 }] } as unknown as TrafficData;
  const enriched = enrichTrafficData(data);
  assert.equal(enriched.segments[0].weekdayDaily, 12345);
  assert.equal(enriched.segments[0].weekendDaily, 6789);
  assert.equal(data.segments[0].activity, undefined);
  assert.ok(enriched.segments[0].activity!.employment > 0.9);
});

test("published games affect only the correct venue, date, arrival and departure windows", () => {
  const event = VENUE_EVENTS[0];
  const activity = { employment: 0, venues: [{ id: event.venueId, proximity: 1 }] };
  const at = { date: event.date, minutes: event.minutes - 35 };
  assert.ok(activityFactor(activity, "weekend", at) > 1);
  assert.equal(activityFactor(activity, "weekend", { ...at, date: "2001-01-01" }), 1);
  assert.equal(activityFactor(activity, "weekend", { ...at, minutes: 0 }), 1);
  assert.ok(activityFactor(activity, "weekend", { ...at, minutes: event.minutes + 195 }) > 1);
  assert.equal(activityFactor(activity, "weekend", { ...at, suppressedVenues: [event.venueId] }), 1);
  assert.equal(activityFactor({ employment: 0, venues: [{ id: "scotiabank-arena", proximity: 1 }] }, "weekend", at), 1);
});

test("manual venue events suppress their automatic uplift; closures do not", () => {
  assert.deepEqual(suppressedVenues([{ kind: "event", position: [-79.3894, 43.6414] }]), ["rogers-centre"]);
  assert.deepEqual(suppressedVenues([{ kind: "closure", position: [-79.3894, 43.6414] }]), []);
});

test("all day/minute combinations remain finite and bounded", () => {
  const activity = { employment: 1, venues: [{ id: "rogers-centre", proximity: 1 }] };
  for (const day of ["weekday", "weekend"] as const) for (let minutes = 0; minutes < 1440; minutes += 5) {
    const factor = activityFactor(activity, day, { date: VENUE_EVENTS[0].date, minutes });
    assert.ok(Number.isFinite(factor) && factor >= 1 && factor <= 1.7);
  }
});
