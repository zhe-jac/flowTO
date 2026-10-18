/**
 * Dock panels (time controls, assistant) expand when their blank space is clicked and minimize when it is
 * double-clicked. Clicks on controls, text fields or conversation text are left alone.
 */
const INTERACTIVE = "button, a, input, textarea, select, label, summary, [role='button'], [role='slider'], [role='tab'], [contenteditable='true'], .traffic-chat-log";

/** The two clicks of a double-click must not undo an expansion the first click just made. */
export const EXPAND_SETTLE_MS = 500;

export function isBlankTarget(target: EventTarget | null) {
  return typeof Element !== "undefined" && target instanceof Element && !target.closest(INTERACTIVE);
}

/** Tracks expansions so a double-click that started on a collapsed panel does not immediately collapse it again. */
export function createDockGesture(now: () => number = () => Date.now()) {
  let expandedAt = -Infinity;
  return {
    /** Call from onClick; returns true when the panel should expand. */
    shouldExpand(collapsed: boolean, target: EventTarget | null, detail: number) {
      if (!collapsed || detail > 1 || !isBlankTarget(target)) return false;
      expandedAt = now();
      return true;
    },
    /** Call from onDoubleClick; returns true when the panel should minimize. */
    shouldCollapse(collapsed: boolean, target: EventTarget | null) {
      return !collapsed && isBlankTarget(target) && now() - expandedAt > EXPAND_SETTLE_MS;
    },
  };
}
