import assert from "node:assert/strict";
import { test } from "node:test";
import { is3DPitch } from "./map-view";

test("tilting past 20 degrees enters 3D and flattening below 8 returns to 2D", () => {
  assert.equal(is3DPitch(10, false), false);
  assert.equal(is3DPitch(25, false), true);
  assert.equal(is3DPitch(12, true), true);
  assert.equal(is3DPitch(5, true), false);
});
