import type { Disruption } from "../disruptions";
import type { Impact, ReroutingPlan } from "./rerouting";
import { disruptionStrength, scaleImpact } from "./scenario-timing";

/** One shared effective plan for road colours, animation, statistics and details. */
export function comparisonImpacts(plan: ReroutingPlan | null | undefined, items: Disruption[], placedAt: ReadonlyMap<string, number>, minutes: number, mode: "before" | "after") {
  const impacts: Record<string, Impact> = {};
  const closed = new Set<string>();
  if (mode === "before") return { impacts, closed };
  // Older rerouters return only an aggregate plan. Keep that response shape
  // usable so the UI can ship independently of the new solver.
  if (plan && !plan.perDisruption) {
    const strength = Math.max(0, ...items.map(item => disruptionStrength(item, placedAt.get(item.id) ?? minutes, minutes)));
    if (strength > 0) for (const [id, impact] of Object.entries(plan.impacts)) impacts[id] = scaleImpact(impact, strength);
  }
  for (const item of items) {
    const strength = disruptionStrength(item, placedAt.get(item.id) ?? minutes, minutes);
    if (strength <= 0) continue;
    if (item.kind !== "event" && item.restriction === "full-closure") closed.add(item.roadId);
    const contribution = plan?.perDisruption?.[item.id];
    if (!contribution) continue;
    for (const [id, impact] of Object.entries(contribution)) {
      const scaled = scaleImpact(impact, strength);
      const current = impacts[id] ??= { retained: 1, capacityScale: 1, addedHourly: 0 };
      current.addedHourly += scaled.addedHourly;
      current.retained = Math.min(current.retained, scaled.retained);
      current.capacityScale = Math.min(current.capacityScale, scaled.capacityScale);
    }
  }
  // A full closure is immediate, even while diversion demand is still building.
  for (const id of closed) impacts[id] = { retained: 0, capacityScale: 0, addedHourly: 0 };
  return { impacts, closed };
}
