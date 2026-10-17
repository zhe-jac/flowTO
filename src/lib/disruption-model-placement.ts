import type { Coordinate } from "./city-boundary";
import type { Road } from "./types";

const CIRCUMFERENCE = 40075016.68557849;
const ORIGIN: Coordinate = [-79.3832, 43.6532];

export function mercatorPosition([lng, lat]: Coordinate) {
  const radians = lat * Math.PI / 180;
  return { x: (lng + 180) / 360, y: (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) / 2, scale: 1 / (CIRCUMFERENCE * Math.cos(radians)) };
}

export const MODEL_ORIGIN = mercatorPosition(ORIGIN);

export function modelOffset(position: Coordinate) {
  const point = mercatorPosition(position);
  return { x: (point.x - MODEL_ORIGIN.x) / MODEL_ORIGIN.scale, y: (MODEL_ORIGIN.y - point.y) / MODEL_ORIGIN.scale, scale: point.scale / MODEL_ORIGIN.scale };
}

export function roadModelRotation(road: Road | undefined, position: Coordinate) {
  if (!road) return 0;
  const origin = modelOffset(position);
  let distance = Infinity;
  let angle = 0;
  for (let index = 1; index < road.geometry.coordinates.length; index++) {
    const a = modelOffset(road.geometry.coordinates[index - 1] as Coordinate);
    const b = modelOffset(road.geometry.coordinates[index] as Coordinate);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.max(0, Math.min(1, ((origin.x - a.x) * dx + (origin.y - a.y) * dy) / length));
    const nextDistance = Math.hypot(origin.x - a.x - t * dx, origin.y - a.y - t * dy);
    if (nextDistance < distance) { distance = nextDistance; angle = Math.atan2(dy, dx) - Math.PI / 2; }
  }
  return angle;
}

export function modelViewVisible(zoom: number, pitch: number) {
  return zoom >= 14.5 && pitch >= 20;
}

export function modelDisplayScale(zoom: number) {
  return Math.max(1, Math.min(3.5, 2 ** (17 - zoom)));
}
