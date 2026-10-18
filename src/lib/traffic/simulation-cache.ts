import type { SimulationResult } from "./simulation-types";

type CachedRun = { key: string; date: string; data: SimulationResult };
const dayMinute = (date: string) => Date.parse(`${date}T00:00:00Z`) / 60000;

export class SimulationCache {
  private scenario = "";
  private runs: CachedRun[] = [];

  useScenario(scenario: string) {
    if (scenario === this.scenario) return;
    this.scenario = scenario;
    this.runs = [];
  }

  store(scenario: string, key: string, date: string, data: SimulationResult) {
    if (scenario !== this.scenario || !data.frames.length) return false;
    if (!this.runs.some(run => run.key === key)) this.runs.push({ key, date, data });
    return true;
  }

  find(date: string, minutes: number) {
    const time = dayMinute(date) + minutes;
    for (const run of this.runs) {
      const minute = time - dayMinute(run.date);
      const start = Math.max(run.data.start, run.data.frames[0].minute);
      const end = Math.min(run.data.end, run.data.frames.at(-1)!.minute);
      if (minute >= start && minute <= end) return { ...run, minute };
    }
    return null;
  }
}
