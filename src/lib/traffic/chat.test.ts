import assert from "node:assert/strict";
import { test } from "node:test";
import { chatDisruptions } from "./chat";
import type { TrafficSegment } from "./types";
const action = { kind: "event", title: "Arena concert", venueId: "scotiabank-arena", attendance: 15000, startMinutes: 1140, durationMinutes: 240 };
test("chat creates a validated venue event with Toronto time metadata", () => {
  const [item] = chatDisruptions([action], [], "2026-10-17");
  assert.equal(item.startsAt, "2026-10-17T19:00");
  assert.equal(item.endsAt, "2026-10-17T23:00");
  assert.deepEqual(item.position, [-79.3791, 43.6435]);
  assert.equal(item.timeZone, "America/Toronto");
});
test("late events roll into the following date", () => {
  const [item] = chatDisruptions([{ ...action, startMinutes: 1380, durationMinutes: 180 }], [], "2026-12-31");
  assert.equal(item.endsAt, "2027-01-01T02:00");
});
test("unknown locations, impossible attendance and malformed actions cannot change the map", () => {
  for (const patch of [{ venueId: "fake" }, { attendance: 999999 }, { attendance: -1 }, { attendance: 3.5 }, { startMinutes: 1440 }, { durationMinutes: 0 }, { title: "" }, { kind: "delete" }]) {
    assert.throws(() => chatDisruptions([{ ...action, ...patch }], [], "2026-10-17"));
  }
  assert.throws(() => chatDisruptions(Array(6).fill(action), [], "2026-10-17"));
  assert.throws(() => chatDisruptions([action], [], "bad-date"));
  assert.deepEqual(chatDisruptions([], [], "2026-10-17"), []);
});
test("closures resolve only to supplied network segments", () => {
  const road = { id: "queen", coords: [[-79.38, 43.65], [-79.379, 43.65]] } as TrafficSegment;
  const closure = { ...action, kind: "closure", roadId: "queen" };
  assert.throws(() => chatDisruptions([closure], [], "2026-10-17"));
  const [item] = chatDisruptions([closure], [road], "2026-10-17");
  assert.equal(item.kind, "closure");
  assert.equal(item.restriction, "full-closure");
});

test("natural road descriptions create one editable multi-segment proposal", async () => {
  const { placementStreets } = await import("./server-data");
  const streets = await placementStreets();
  const [proposal] = chatDisruptions([{ kind: "closure", title: "Queen closure", roadName: "Queen Street West", fromStreet: "Spadina", toStreet: "University", startMinutes: 1020, durationMinutes: 120 }], [], "2026-10-17", streets);
  assert.equal(proposal.kind, "closure");
  assert.equal(proposal.startsAt, "2026-10-17T17:00");
  assert.equal(proposal.locationLabel, "Queen St W: Spadina Ave → University Ave · both directions");
  assert.ok(proposal.roadSections!.length > 1);
  assert.ok(proposal.roadSections!.some(section => section.roadId === proposal.roadId));
  assert.throws(() => chatDisruptions([{ kind: "closure", title: "Unspecified extent", roadName: "Queen", startMinutes: 1020, durationMinutes: 120 }], [], "2026-10-17", streets), /cross-streets/);
});
