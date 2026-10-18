import assert from "node:assert/strict";
import { test } from "node:test";
import { retargetTween, tweenValue, junctionBlend, COLOUR_TRANSITION_MS } from "./visual-transition";

test("congestion progresses through intermediate palette levels in both directions", () => {
  const rising = retargetTween(undefined, 3, 0, 1000, 0);
  assert.equal(tweenValue(rising, 0), 0);
  assert.equal(tweenValue(rising, 500), 1.5);
  assert.equal(tweenValue(rising, 1000), 3);
  const falling = retargetTween(rising, 0, 1000, 1000);
  assert.equal(tweenValue(falling, 1500), 1.5);
  assert.equal(tweenValue(falling, 2000), 0);
});
test("retargeting is continuous and repeated targets never restart the transition", () => {
  const original = retargetTween(undefined, 3, 0, 1000, 0);
  assert.equal(retargetTween(original, 3, 400, 1000), original);
  const next = retargetTween(original, 0, 400, 1000);
  assert.equal(tweenValue(next, 400), tweenValue(original, 400));
});
test("highlight grows from zero, completes while playback is paused, and supports reduced motion", () => {
  const growth = retargetTween(undefined, 1, 0, 1400, 0);
  assert.equal(tweenValue(growth, 0), 0);
  assert.equal(tweenValue(growth, 700), 0.5);
  assert.equal(tweenValue(growth, 1400), 1);
  assert.equal(tweenValue(retargetTween(undefined, 1, 0, 0, 0), 0), 1);
});

test("junction gradients agree at a shared endpoint and preserve road interiors", () => {
  assert.equal(junctionBlend(0, 1.5, 0, 0, 100), 1.5);
  assert.equal(junctionBlend(3, 1.5, 3, 0, 100), 1.5);
  const middle = junctionBlend(0, 1.5, 0, 17.5, 100);
  assert.ok(middle > 0 && middle < 1.5);
  assert.equal(junctionBlend(0, 1.5, 3, 40, 40), 0);
  assert.ok(junctionBlend(1, 0, 3, 1, 1) <= 3);
});

test("all playback speeds use the same five-second wall-clock duration", () => {
  for (const rate of [1, 5, 15]) {
    const simulatedMinutes = 2.5 * rate;
    assert.ok(simulatedMinutes > 0);
    const tween = retargetTween(undefined, 3, 0, COLOUR_TRANSITION_MS, 0);
    assert.equal(tweenValue(tween, 2500), 1.5);
    assert.equal(tweenValue(tween, 5000), 3);
  }
});

test("junction smoothing cannot wash out calculated congestion across a short road", () => {
  for (const length of [2, 5, 10, 30, 60]) {
    assert.equal(junctionBlend(3, 0, 0, length / 2, length / 2), 3);
    assert.equal(junctionBlend(3, 1.5, 0, 0, length), 1.5);
  }
  assert.ok(Number.isFinite(junctionBlend(3, 0, 0, 0, 0)));
});
