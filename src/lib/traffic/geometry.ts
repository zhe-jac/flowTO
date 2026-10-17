import type { FeatureCollection, LineString, MultiLineString } from "geojson";
import type { TrafficData } from "./types";

export function prepareTrafficCoordinates(points: number[][]): [number, number][] {
  const result: [number, number][] = [];
  for (const [lng, lat] of points) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("Traffic geometry contains an invalid coordinate.");
    const point: [number, number] = [Number(lng.toFixed(7)), Number(lat.toFixed(7))];
    const previous = result.at(-1);
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) result.push(point);
  }
  return result;
}

export function restoreTrafficGeometry(data: TrafficData, source: FeatureCollection<LineString | MultiLineString>): TrafficData {
  const wanted = new Set(data.segments.map((segment) => segment.id));
  const coordinates = new Map<string, [number, number][]>();
  for (const feature of source.features) {
    if (!feature.geometry || !feature.properties?.CENTRELINE_ID) continue;
    const parts = (feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates).filter((part) => part.length > 1);
    parts.forEach((part, index) => {
      const id = parts.length === 1 ? String(feature.properties!.CENTRELINE_ID) : `${feature.properties!.CENTRELINE_ID}:${index}`;
      if (wanted.has(id)) coordinates.set(id, prepareTrafficCoordinates(part));
    });
  }
  return {
    ...data,
    segments: data.segments.map((segment) => {
      const coords = coordinates.get(segment.id);
      if (!coords || coords.length < 2) throw new Error(`Source geometry is missing or degenerate for traffic segment ${segment.id}.`);
      if (coords.length > segment.coords.length) throw new Error(`Source geometry changed vertex count for traffic segment ${segment.id}. Rebuild traffic data from the source.`);
      return { ...segment, coords };
    }),
  };
}
