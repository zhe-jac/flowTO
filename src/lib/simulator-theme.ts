import { simulatorLight } from "./daylight";

export type SimulatorTheme = "day" | "night";

/** Day or night at a simulator time, switching halfway through Toronto's dawn and dusk for today's date. */
export function simulatorTheme(minutes: number, date = new Date()): SimulatorTheme {
  return simulatorLight(minutes, date).theme;
}
