import type { Disruption } from "../disruptions";
export function closedRoadIds(items: Disruption[]) {
    return new Set(items.flatMap((item) => item.kind !== "event" && item.restriction === "full-closure" ? [item.roadId] : []));
}
