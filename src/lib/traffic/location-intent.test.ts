import assert from "node:assert/strict";
import test from "node:test";
import { groundLocationAction } from "./location-intent";
import { nameScore, streetName } from "./street-names";
import { roadTravelDirections } from "./road-travel";
import type { ChatAction } from "./chat";
import type { RoadDisruption } from "../disruptions";

const action: ChatAction = { kind: "closure", title: "Closure", roadName: "Gardiner Lakeshore W Ramp", fromStreet: "Spadina Road", toStreet: "York Street", startMinutes: 1020, durationMinutes: 120 };

test("street aliases normalize without conflating ramps, street types or geographic suffixes", () => {
  for (const [a, b] of [["Gardiner Expressway", "F G Gardiner Xy E"], ["DVP", "Don Valley Parkway"], ["Lakeshore Boulevard", "Lake Shore Blvd W"]]) assert.equal(nameScore(streetName(a), streetName(b)), 100);
  for (const [a, b] of [["Queen", "Queensway"], ["Gardiner", "Gardiner Lakeshore W Ramp"], ["Spadina Ave", "Spadina Rd"], ["Queen St W", "Queen St E"]]) assert.equal(nameScore(streetName(a), streetName(b)), 0);
  assert.ok(nameScore(streetName("Quene Street"), streetName("Queen St W")) > 0);
  assert.ok(nameScore(streetName("Yong St"), streetName("Yonge St")) > 0);
  assert.equal(nameScore(streetName("Yong St"), streetName("York St")), 0);
  assert.equal(nameScore(streetName("Bay St"), streetName("Bath St")), 0);
});

test("user wording overrides a model's guessed ramp and cross-street variants", () => {
  const result = groundLocationAction(action, "close both ways of the gardiner expy from spadina ave to york st");
  assert.equal(result.roadName, "gardiner expy");
  assert.equal(result.fromStreet, "spadina ave");
  assert.equal(result.toStreet, "york st");
  assert.equal(result.travelDirection, "both");
  assert.equal(groundLocationAction(action, "Close the Gardiner Expressway in both directions from Spadina Ave to York St").roadName, "Gardiner Expressway");
});

test("geographic suffixes remain distinct from travel direction", () => {
  const result = groundLocationAction(action, "Close the eastbound lanes of Queen Street West from Spadina to University from 5 PM to 7 PM");
  assert.equal(result.roadName, "Queen Street West");
  assert.equal(result.toStreet, "University");
  assert.equal(result.travelDirection, "eastbound");
  assert.equal(groundLocationAction(action, "Close Queen Street West from Spadina to University east-bound").toStreet, "University");
  const generic = groundLocationAction({ ...action, roadName: "Queen St W", travelDirection: "westbound" }, "Close Queen Street from Spadina to Jarvis");
  assert.equal(generic.roadName, "Queen Street");
  assert.equal(generic.travelDirection, "both");
});

test("separate road commands retain their own limits and directions", () => {
  const text = "Close eastbound Queen from Spadina to University; close westbound King from Bathurst to Spadina";
  const first = groundLocationAction(action, text, 0), second = groundLocationAction(action, text, 1);
  assert.equal(first.roadName, "Queen");
  assert.equal(first.travelDirection, "eastbound");
  assert.equal(second.roadName, "King");
  assert.equal(second.fromStreet, "Bathurst");
  assert.equal(second.travelDirection, "westbound");
});

test("conjunctions separate road requests without entering their street names", () => {
  for (const separator of [" and ", " and then ", ", then ", "; ", " & "]) {
    const text = `close king st from university ave to yong st${separator}close adelaide st from university ave to yonge st`;
    const king = groundLocationAction({ ...action, roadName: "King St W" }, text, 0);
    const adelaide = groundLocationAction({ ...action, roadName: "Adelaide St W" }, text, 1);
    assert.equal(king.toStreet, "yong st", separator);
    assert.equal(adelaide.toStreet, "yonge st", separator);
    assert.equal(adelaide.roadName, "adelaide st", separator);
  }
});

test("road commands match their model actions even when returned in another order", () => {
  const text = "close King St between University Ave and Yonge St and add construction on Adelaide St from University Ave to Yonge St";
  const construction = groundLocationAction({ ...action, kind: "construction", roadName: "Adelaide St W" }, text, 0);
  const king = groundLocationAction({ ...action, roadName: "King St W" }, text, 1);
  assert.equal(construction.roadName, "Adelaide St");
  assert.equal(construction.fromStreet, "University Ave");
  assert.equal(king.roadName, "King St");
  assert.equal(king.toStreet, "Yonge St");
});

test("travel direction follows the digitization of each selected section", () => {
  const item: RoadDisruption = { id: "closure", title: "Closure", kind: "closure", roadId: "one", position: [-79.4, 43.65], startsAt: "", endsAt: "", timeZone: "America/Toronto", restriction: "full-closure", travelDirection: "eastbound", roadSections: [{ roadId: "one", from: 0, to: 1 }, { roadId: "two", from: 1, to: 0 }] };
  const coordinates: Record<string, number[][]> = { one: [[-79.4, 43.65], [-79.399, 43.65]], two: [[-79.398, 43.65], [-79.399, 43.65]] };
  assert.deepEqual([...roadTravelDirections(item, id => coordinates[id])!], [["one", 1], ["two", -1]]);
  assert.deepEqual([...roadTravelDirections({ ...item, travelDirection: "westbound" }, id => coordinates[id])!], [["one", -1], ["two", 1]]);
  assert.equal(roadTravelDirections({ ...item, travelDirection: "both" }, id => coordinates[id]), null);
});
