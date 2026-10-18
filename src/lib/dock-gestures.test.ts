import assert from "node:assert/strict";
import { test } from "node:test";
import { createDockGesture, EXPAND_SETTLE_MS } from "./dock-gestures";

class FakeElement { constructor(private readonly interactive = false) {} closest() { return this.interactive ? this : null; } }
(globalThis as { Element?: unknown }).Element = FakeElement;
const blank = new FakeElement() as unknown as Element;
const button = new FakeElement(true) as unknown as Element;

test("a click on blank space expands a collapsed panel; controls are ignored", () => {
  const gesture = createDockGesture(() => 0);
  assert.equal(gesture.shouldExpand(true, button, 1), false);
  assert.equal(gesture.shouldExpand(false, blank, 1), false);
  assert.equal(gesture.shouldExpand(true, blank, 1), true);
});

test("a double-click minimizes, but not right after the same gesture expanded the panel", () => {
  let time = 0;
  const gesture = createDockGesture(() => time);
  gesture.shouldExpand(true, blank, 1);
  time = 200;
  assert.equal(gesture.shouldCollapse(false, blank), false, "second click of the expanding double-click");
  time = EXPAND_SETTLE_MS + 300;
  assert.equal(gesture.shouldCollapse(false, button), false);
  assert.equal(gesture.shouldCollapse(true, blank), false);
  assert.equal(gesture.shouldCollapse(false, blank), true);
});
