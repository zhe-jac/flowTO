const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return t * t * (3 - 2 * t);
};

export function weatherDepth(pitch: number) {
  return smooth((pitch - 8) / 52);
}

export function stormStrength(rain: number) {
  return smooth((rain - 85) / 15);
}

export function lightningDelay(strength: number, random: number) {
  const weight = Math.max(0, Math.min(1, strength));
  return 8000 + (1 - weight) * 8000 + Math.max(0, Math.min(1, random)) * 7000;
}

export function nextLightningTime(now: number, lastStrike: number, strength: number, random: number, initial = false) {
  const delay = initial ? 1000 + Math.max(0, Math.min(1, random)) * 750 : lightningDelay(strength, random);
  return Math.max(now + delay, lastStrike + 8000);
}

export type LightningPattern = { secondAt: number | null; secondStrength: number; decay: number };

export function lightningPattern(roll: number, variation: number): LightningPattern {
  const t = Math.max(0, Math.min(1, variation));
  const double = roll < 0.45;
  return { secondAt: double ? 300 + t * 160 : null, secondStrength: 0.65 + t * 0.25, decay: double ? 180 + t * 80 : 280 + t * 260 };
}

const SINGLE_LIGHTNING = lightningPattern(1, 0.5);

export function lightningEnvelope(age: number, pattern = SINGLE_LIGHTNING) {
  const pulse = (time: number, decay: number) => time < 0 || time >= decay + 35 ? 0 : smooth(time / 35) * (1 - smooth((time - 35) / decay));
  const first = pulse(age, pattern.decay);
  const second = pattern.secondAt === null ? 0 : pulse(age - pattern.secondAt, pattern.decay * 1.4) * pattern.secondStrength;
  return Math.max(first, second);
}
