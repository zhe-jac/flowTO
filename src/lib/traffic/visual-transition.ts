/** A real-time scalar tween; retargeting continues from the displayed value. */
export type VisualTween = { from: number; to: number; started: number; duration: number };
export const COLOUR_TRANSITION_MS = 5000;
export const HIGHLIGHT_TRANSITION_MS = 3000;

export class TimelineTransitions {
  revision = 0;
  dragging = false;
  private pending = false;

  get immediate() { return this.dragging || this.pending; }
  seek() { this.revision++; this.pending = true; }
  settle(revision: number, loading: boolean) { if (revision === this.revision && !loading) this.pending = false; }
}

export function tweenValue(tween: VisualTween, now: number) {
  const t = tween.duration <= 0 ? 1 : Math.max(0, Math.min(1, (now - tween.started) / tween.duration));
  const eased = t * t * (3 - 2 * t);
  return tween.from + (tween.to - tween.from) * eased;
}
export function retargetTween(previous: VisualTween | undefined, target: number, now: number, duration: number, initial = target): VisualTween {
  if (duration <= 0) return { from: target, to: target, started: now, duration: 0 };
  if (previous?.to === target) return previous;
  return { from: previous ? tweenValue(previous, now) : initial, to: target, started: now, duration };
}
