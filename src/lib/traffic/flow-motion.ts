export const PULSE_SPACING = 18;

export function continuousPulseOffset(offset: number, oldSpeed: number, newSpeed: number, time: number) {
  const next = offset + (oldSpeed - newSpeed) * time;
  return ((next % PULSE_SPACING) + PULSE_SPACING) % PULSE_SPACING;
}
