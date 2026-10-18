import type { Disruption } from "../disruptions";
import { shiftSimulationDate } from "./simulation-date";
import type { DisruptionPlacement } from "./scenario-timing";

export function localSimulationStamp(date: string, minutes: number) {
  const whole = Math.floor(minutes);
  const clock = ((whole % 1440) + 1440) % 1440;
  return `${shiftSimulationDate(date, Math.floor(whole / 1440))}T${String(Math.floor(clock / 60)).padStart(2, "0")}:${String(clock % 60).padStart(2, "0")}`;
}

function physicalSettings(item: Disruption) {
  return JSON.stringify(item.kind === "event" ? [item.kind, item.position, item.attendance] : [item.kind, item.position, item.roadId, item.roadSections, item.restriction, item.travelDirection]);
}

export class SimulationHistory {
  private records = new Map<string, Disruption>();
  private current = new Map<string, Disruption>();
  private originals = new Map<string, Disruption>();
  private revision = 0;

  reset() { this.records.clear(); this.current.clear(); this.originals.clear(); }

  update(items: Disruption[], date: string, minutes: number, anchor: number, placedAt?: ReadonlyMap<string, DisruptionPlacement>): Disruption[] {
    const now = localSimulationStamp(date, minutes);
    for (const item of items) {
      const original = this.originals.get(item.id);
      if (original && JSON.stringify(original) === JSON.stringify(item)) continue;
      const previous = this.current.get(item.id);
      const placement = placedAt?.get(item.id);
      const start = typeof placement === "object" ? localSimulationStamp(placement.date, placement.minutes) : localSimulationStamp(date, typeof placement === "number" ? placement : minutes);
      const normalized = { ...item, startsAt: item.startsAt || previous?.startsAt || start, endsAt: item.endsAt || `${shiftSimulationDate((previous?.startsAt || start).slice(0, 10), 1)}T00:00` };
      const scheduleChanged = original && (original.startsAt !== item.startsAt || original.endsAt !== item.endsAt);
      if (previous && original && !scheduleChanged && physicalSettings(original) !== physicalSettings(item) && previous.startsAt < now && previous.endsAt > now && normalized.endsAt > now) {
        const historical = { ...previous, id: `${item.id}:history:${++this.revision}`, endsAt: now };
        this.records.set(historical.id, historical);
        normalized.startsAt = now;
      }
      this.originals.set(item.id, item);
      this.current.set(item.id, normalized);
      this.records.set(item.id, normalized);
    }
    const ids = new Set(items.map(item => item.id));
    for (const [id, previous] of this.current) if (!ids.has(id)) {
      if (previous.startsAt < now) this.records.set(id, { ...previous, endsAt: now < previous.endsAt ? now : previous.endsAt });
      else this.records.delete(id);
      this.current.delete(id);
      this.originals.delete(id);
    }
    while (this.records.size > 60) {
      const historical = [...this.records.keys()].find(id => !ids.has(id));
      if (!historical) break;
      this.records.delete(historical);
    }
    const relevant = [...this.records.values()].filter(item => item.endsAt > localSimulationStamp(date, -1440) && item.startsAt <= localSimulationStamp(date, anchor + 120));
    const active = relevant.filter(item => ids.has(item.id));
    const remaining = Math.max(0, 40 - active.length);
    return [...(remaining ? relevant.filter(item => !ids.has(item.id)).slice(-remaining) : []), ...active];
  }
}
