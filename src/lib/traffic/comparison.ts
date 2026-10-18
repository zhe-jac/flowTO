import type { Disruption } from "../disruptions";
import { mergeImpact, type Impact, type ReroutingPlan } from "./rerouting";
import { disruptionStrength, scaleImpact, type DisruptionPlacement } from "./scenario-timing";
import { affectedRoadIds } from "../road-extent";

/** One shared effective plan for road colours, animation, statistics and details. */
export function comparisonImpacts(plan: ReroutingPlan | null | undefined, items: Disruption[], placedAt: ReadonlyMap<string, DisruptionPlacement>, minutes: number, mode: "before" | "after", date?: string) {
  if (plan?.simulation) return { impacts: mode === "before" ? plan.simulation.baseline : { ...plan.simulation.baseline, ...plan.impacts }, closed: new Set(mode === "before" ? [] : plan.simulation.closed) };
  const impacts: Record<string, Impact> = {};
  const closed = new Set<string>();
  if (mode === "before") return { impacts, closed };
  // Older rerouters return only an aggregate plan. Keep that response shape
  // usable so the UI can ship independently of the new solver.
  if (plan && !plan.perDisruption) {
    const strength = Math.max(0, ...items.map(item => disruptionStrength(item, placedAt.get(item.id) ?? minutes, minutes, date)));
    if (strength > 0) for (const [id, impact] of Object.entries(plan.impacts)) impacts[id] = scaleImpact(impact, strength);
  }
  for (const item of items) {
    const strength = disruptionStrength(item, placedAt.get(item.id) ?? minutes, minutes, date);
    if (strength <= 0) continue;
    if (item.kind !== "event" && item.restriction === "full-closure") for (const roadId of affectedRoadIds(item)) closed.add(roadId);
    const contribution = plan?.perDisruption?.[item.id];
    if (!contribution) continue;
    for (const [id, impact] of Object.entries(contribution)) {
      const scaled = scaleImpact(impact, strength);
      const current = impacts[id] ??= { retained: 1, capacityScale: 1, addedHourly: 0 };
      mergeImpact(current, scaled);
    }
  }
  for (const id of closed) impacts[id] = { retained: 0, capacityScale: 0, addedHourly: 0 };
  return { impacts, closed };
}
