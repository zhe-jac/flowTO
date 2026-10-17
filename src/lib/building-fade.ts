import type { Coordinate } from "./city-boundary";

export type FadePoint = { x: number; y: number };
export type FadeRoad = { coords: number[][]; cls: string };
export const BUILDING_FADE_FOCUS_EVENT = "disruption-fade-focus";
export const BUILDING_FADE_RADIUS = 88;
const focusByCanvas = new WeakMap<HTMLCanvasElement, FadePoint | null>();
export const FADE_ORIGIN = mercatorPosition([-79.3832, 43.6532]);

export function mercatorPosition([longitude, latitude]: Coordinate): [number, number] {
  const y = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
  return [(longitude + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + y / 2)) / Math.PI) / 2];
}

export function buildingFadeStrength(pitch: number) {
  const t = Math.max(0, Math.min(1, (pitch - 8) / 47));
  return (t * t * (3 - 2 * t)) * 0.72;
}

export function fadeRoadVisibility(roadClass: string) {
  if (roadClass === "Local") return { minZoom: 14.2, width: 13 };
  if (/Collector/.test(roadClass)) return { minZoom: 12.8, width: 16 };
  return { minZoom: 10, width: 20 };
}

export function buildingFadeGeometry(roads: readonly FadeRoad[], zoom = Infinity) {
  const data: number[] = [];
  for (const road of roads) {
    const { minZoom, width } = fadeRoadVisibility(road.cls);
    if (zoom < minZoom) continue;
    for (let index = 1; index < road.coords.length; index++) {
      const a = road.coords[index - 1], b = road.coords[index];
      if (![a[0], a[1], b[0], b[1]].every(Number.isFinite) || a[0] === b[0] && a[1] === b[1]) continue;
      const from = mercatorPosition([a[0], a[1]]), to = mercatorPosition([b[0], b[1]]);
      data.push(from[0] - FADE_ORIGIN[0], from[1] - FADE_ORIGIN[1], to[0] - FADE_ORIGIN[0], to[1] - FADE_ORIGIN[1], width, minZoom);
    }
  }
  return new Float32Array(data);
}

export function localFadeMatrix(matrix: ArrayLike<number>) {
  const result = new Float32Array(matrix);
  for (let row = 0; row < 4; row++) result[12 + row] = matrix[12 + row] + matrix[row] * FADE_ORIGIN[0] + matrix[4 + row] * FADE_ORIGIN[1];
  return result;
}

export function invertFadeMatrix(matrix: ArrayLike<number>): Float32Array | null {
  const rows = Array.from({ length: 4 }, (_, row) => Array.from({ length: 8 }, (_, column) => column < 4 ? matrix[column * 4 + row] : Number(column - 4 === row)));
  for (let column = 0; column < 4; column++) {
    let pivot = column;
    for (let row = column + 1; row < 4; row++) if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row;
    if (Math.abs(rows[pivot][column]) < 1e-14) return null;
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    const divisor = rows[column][column];
    for (let index = 0; index < 8; index++) rows[column][index] /= divisor;
    for (let row = 0; row < 4; row++) {
      if (row === column) continue;
      const factor = rows[row][column];
      for (let index = 0; index < 8; index++) rows[row][index] -= factor * rows[column][index];
    }
  }
  return Float32Array.from({ length: 16 }, (_, index) => rows[index % 4][4 + Math.floor(index / 4)]);
}

export function setBuildingFadeFocus(canvas: HTMLCanvasElement, point: FadePoint | null) {
  focusByCanvas.set(canvas, point);
  canvas.dispatchEvent(new Event(BUILDING_FADE_FOCUS_EVENT));
}

export function getBuildingFadeFocus(canvas: HTMLCanvasElement) {
  return focusByCanvas.get(canvas) ?? null;
}
