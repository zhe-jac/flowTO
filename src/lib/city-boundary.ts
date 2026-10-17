import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import boundaryData from "./data/toronto-boundary.json";

export type Coordinate = [number, number];
export const TORONTO_BOUNDARY = boundaryData as Feature<MultiPolygon>;
export const TORONTO_MIN_ZOOM = 10.3;
const vertices = TORONTO_BOUNDARY.geometry.coordinates.flat(2);
const extent = vertices.reduce((bounds, point) => [Math.min(bounds[0], point[0]), Math.min(bounds[1], point[1]), Math.max(bounds[2], point[0]), Math.max(bounds[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity]);
export const TORONTO_BOUNDS: [Coordinate, Coordinate] = [[extent[0], extent[1]], [extent[2], extent[3]]];
export const BOUNDARY_ATTRIBUTION = '<a href="https://open.toronto.ca/dataset/regional-municipal-boundary/" target="_blank" rel="noopener noreferrer">Boundary: City of Toronto</a>';

function ringRelation(point: Coordinate, ring: Position[]): -1 | 0 | 1 {
  const [x, y] = point;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [ax, ay] = ring[previous];
    const [bx, by] = ring[index];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-11 && x >= Math.min(ax, bx) - 1e-11 && x <= Math.max(ax, bx) + 1e-11 && y >= Math.min(ay, by) - 1e-11 && y <= Math.max(ay, by) + 1e-11) return 0;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 1 : -1;
}

export function isPointInBoundary(point: Coordinate, geometry: Polygon | MultiPolygon): boolean {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => ringRelation(point, polygon[0]) >= 0 && !polygon.slice(1).some((hole) => ringRelation(point, hole) === 1));
}

export function isPointInToronto(point: Coordinate): boolean {
  if (!point.every(Number.isFinite)) return false;
  if (point[0] < extent[0] || point[0] > extent[2] || point[1] < extent[1] || point[1] > extent[3]) return false;
  return isPointInBoundary(point, TORONTO_BOUNDARY.geometry);
}

export function createOutsideMask(geometry: Polygon | MultiPolygon): Feature<MultiPolygon> {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const world = [[-180, -85.051128], [180, -85.051128], [180, 85.051128], [-180, 85.051128], [-180, -85.051128]];
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPolygon",
      coordinates: [
        [world, ...polygons.map((polygon) => polygon[0].slice().reverse())],
        ...polygons.flatMap((polygon) => polygon.slice(1).map((hole) => [hole.slice().reverse()])),
      ],
    },
  };
}

export const OUTSIDE_TORONTO_MASK = createOutsideMask(TORONTO_BOUNDARY.geometry);

export function constrainToToronto(previous: Coordinate, requested: Coordinate): Coordinate {
  if (isPointInToronto(requested)) return requested;
  const origin: Coordinate = isPointInToronto(previous) ? previous : [-79.3832, 43.6532];
  if (!requested.every(Number.isFinite)) return origin;
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 28; iteration++) {
    const fraction = (low + high) / 2;
    const candidate: Coordinate = [origin[0] + (requested[0] - origin[0]) * fraction, origin[1] + (requested[1] - origin[1]) * fraction];
    if (isPointInToronto(candidate)) low = fraction;
    else high = fraction;
  }
  const point: Coordinate = [origin[0] + (requested[0] - origin[0]) * low, origin[1] + (requested[1] - origin[1]) * low];
  return isPointInToronto(point) ? point : origin;
}

type CityCamera = {
  getCenter: () => { lng: number; lat: number };
  on: (event: "move", listener: () => void) => unknown;
  off: (event: "move", listener: () => void) => unknown;
  stop: () => unknown;
  jumpTo: (options: { center: Coordinate }) => unknown;
};

export function restrictCameraToToronto(map: CityCamera): () => void {
  const initial = map.getCenter();
  let lastValid = constrainToToronto([-79.3832, 43.6532], [initial.lng, initial.lat]);
  let correcting = false;
  const enforce = () => {
    if (correcting) return;
    const center = map.getCenter();
    const requested: Coordinate = [center.lng, center.lat];
    if (isPointInToronto(requested)) {
      lastValid = requested;
      return;
    }
    const constrained = constrainToToronto(lastValid, requested);
    correcting = true;
    try {
      map.stop();
      map.jumpTo({ center: constrained });
      lastValid = constrained;
    } finally {
      correcting = false;
    }
  };
  map.on("move", enforce);
  enforce();
  return () => { map.off("move", enforce); };
}
