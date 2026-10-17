/** A real-time scalar tween; retargeting continues from the displayed value. */
export type VisualTween = { from: number; to: number; started: number; duration: number };
export const COLOUR_TRANSITION_MS = 5000;
export const HIGHLIGHT_TRANSITION_MS = 3000;

/** Blend only near actual connected endpoints, leaving road interiors intact. */
export function junctionBlend(own: number, start: number, end: number, fromStartM: number, fromEndM: number) {
  const weight = (metres: number) => {
    const t = Math.max(0, Math.min(1, 1 - metres / 35));
    return t * t * (3 - 2 * t);
  };
  const a = weight(fromStartM), b = weight(fromEndM), sum = Math.max(1, a + b);
  return own * (1 - (a + b) / sum) + (start * a + end * b) / sum;
}
export function tweenValue(tween: VisualTween, now: number) {
  const t = tween.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - tween.started) / tween.duration));
  const eased = t * t * (3 - 2 * t);
  return tween.from + (tween.to - tween.from) * eased;
}
export function retargetTween(previous: VisualTween | undefined, target: number, now: number, duration: number, initial = target): VisualTween {
  if (previous?.to === target) return previous;
  return { from: previous ? tweenValue(previous, now) : initial, to: target, started: now, duration };
}
