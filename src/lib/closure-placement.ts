import type { FeatureCollection, LineString, Point } from "geojson";
import type { Road } from "./types";

export type ScreenPoint = { x: number; y: number };
export type RoadSnap = { road: Road; point: ScreenPoint; distance: number };

export function nearestRoad(roads: Road[], target: ScreenPoint, project: (coordinate: [number, number]) => ScreenPoint, radius = 24): RoadSnap | null {
  let nearest: RoadSnap | null = null;
  for (const road of roads) {
    const coordinates = road.geometry.coordinates;
    for (let index = 1; index < coordinates.length; index++) {
      const a = project([coordinates[index - 1][0], coordinates[index - 1][1]]);
      const b = project([coordinates[index][0], coordinates[index][1]]);
      if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = dx * dx + dy * dy;
      const fraction = length ? Math.max(0, Math.min(1, ((target.x - a.x) * dx + (target.y - a.y) * dy) / length)) : 0;
      const point = { x: a.x + fraction * dx, y: a.y + fraction * dy };
      const distance = Math.hypot(target.x - point.x, target.y - point.y);
      if (distance <= radius && (!nearest || distance < nearest.distance)) nearest = { road, point, distance };
    }
  }
  return nearest;
}

export function closureFeatures(roads: Road[]): FeatureCollection<LineString | Point> {
  return {
    type: "FeatureCollection",
    features: roads.flatMap((road) => [
      road,
      ...[road.geometry.coordinates[0], road.geometry.coordinates.at(-1)].filter((coordinate) => coordinate !== undefined).map((coordinate) => ({
        type: "Feature" as const,
        properties: road.properties,
        geometry: { type: "Point" as const, coordinates: coordinate },
      })),
    ]),
  };
}
