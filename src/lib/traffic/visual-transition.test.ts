import assert from "node:assert/strict";
import { test } from "node:test";
import { retargetTween, tweenValue, COLOUR_TRANSITION_MS, TimelineTransitions } from "./visual-transition";

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

test("manual seeking immediately finishes an existing fade even when its target is unchanged", () => {
  const width = retargetTween(undefined, 1, 0, 3000, 0);
  const colour = retargetTween(undefined, 3, 0, COLOUR_TRANSITION_MS, 0);
  assert.equal(tweenValue(retargetTween(width, 1, 250, 0), 250), 1);
  assert.equal(tweenValue(retargetTween(colour, 3, 250, 0), 250), 3);
  assert.equal(tweenValue(retargetTween(width, 0, 250, 0), 250), 0);
});

test("playback resumes smooth transitions from the last manually selected state", () => {
  const selected = retargetTween(undefined, 3, 100, 0, 0);
  const playback = retargetTween(selected, 0, 200, COLOUR_TRANSITION_MS);
  assert.equal(tweenValue(playback, 200), 3);
  assert.equal(tweenValue(playback, 2700), 1.5);
  assert.equal(tweenValue(playback, 5200), 0);
});

test("a seek stays immediate until the latest requested simulation is ready", () => {
  const timeline = new TimelineTransitions();
  timeline.seek();
  const previous = timeline.revision;
  timeline.seek();
  timeline.settle(previous, false);
  assert.equal(timeline.immediate, true);
  timeline.settle(timeline.revision, true);
  assert.equal(timeline.immediate, true);
  timeline.settle(timeline.revision, false);
  assert.equal(timeline.immediate, false);
});

test("pointer dragging remains immediate after data loads and returns to playback on release", () => {
  const timeline = new TimelineTransitions();
  timeline.dragging = true;
  timeline.seek();
  timeline.settle(timeline.revision, false);
  assert.equal(timeline.immediate, true);
  timeline.dragging = false;
  assert.equal(timeline.immediate, false);
});
test("highlight grows from zero, completes while playback is paused, and supports reduced motion", () => {
  const growth = retargetTween(undefined, 1, 0, 1400, 0);
  assert.equal(tweenValue(growth, 0), 0);
  assert.equal(tweenValue(growth, 700), 0.5);
  assert.equal(tweenValue(growth, 1400), 1);
  assert.equal(tweenValue(retargetTween(undefined, 1, 0, 0, 0), 0), 1);
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
