import type { RoadCollection, Scenario } from "./types";

export const EMPTY_SCENARIO: Scenario = { version: 1, name: "Downtown exploration", closedRoadIds: [] };
export const STORAGE_KEY = "toronto-sandbox:scenario:v1";

export function parseScenario(raw: string | null, validIds: Set<string>): Scenario | null {
  if (!raw || raw.length > 20000) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (item.version !== 1 || typeof item.name !== "string" || !Array.isArray(item.closedRoadIds)) return null;
    const closedRoadIds = [...new Set(item.closedRoadIds.filter((id): id is string => typeof id === "string" && validIds.has(id)))].slice(0, 100);
    return { version: 1, name: item.name.trim().slice(0, 80) || EMPTY_SCENARIO.name, closedRoadIds };
  } catch {
    return null;
  }
}

export function toggleClosure(scenario: Scenario, id: string): Scenario {
  const exists = scenario.closedRoadIds.includes(id);
  if (!exists && scenario.closedRoadIds.length >= 100) return scenario;
  return { ...scenario, closedRoadIds: exists ? scenario.closedRoadIds.filter((item) => item !== id) : [...scenario.closedRoadIds, id] };
}

export function getOpenRoads(roads: RoadCollection, closedRoadIds: string[]): RoadCollection {
  const closed = new Set(closedRoadIds);
  return { type: "FeatureCollection", features: roads.features.filter((road) => !closed.has(road.properties.id)) };
}
