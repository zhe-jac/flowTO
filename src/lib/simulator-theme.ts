export type SimulatorTheme = "day" | "night";

export function simulatorTheme(minutes: number): SimulatorTheme {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  return wrapped < 360 || wrapped >= 1080 ? "night" : "day";
}
