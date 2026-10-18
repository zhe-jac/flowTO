import type { Disruption } from "../disruptions";
import { affectedRoadIds } from "../road-extent";
export function closedRoadIds(items: Disruption[]) {
    return new Set(items.flatMap((item) => item.kind !== "event" && item.restriction === "full-closure" && (!item.travelDirection || item.travelDirection === "both") ? affectedRoadIds(item) : []));
}

export function expandRoadDisruptions(items: Disruption[]): Disruption[] {
    return items.flatMap<Disruption>(item => {
        if (item.kind === "event") return [item];
        const ids = affectedRoadIds(item);
        return ids.map((roadId, index) => ({ ...item, roadId, id: ids.length === 1 ? item.id : `${item.id}/road/${index}`, roadSections: undefined }));
    });
}
