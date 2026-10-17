import type { TrafficSegment } from "./types";

export type TrafficBounds = [number, number, number, number];
const CELL_SIZE = 0.01;

function intersects(a: TrafficBounds, b: TrafficBounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function createTrafficViewport(segments: TrafficSegment[]) {
  const boxes: TrafficBounds[] = [];
  const cells = new Map<string, number[]>();
  const extent: TrafficBounds = [Infinity, Infinity, -Infinity, -Infinity];
  segments.forEach((segment, index) => {
    const box: TrafficBounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lng, lat] of segment.coords) {
      box[0] = Math.min(box[0], lng);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lng);
      box[3] = Math.max(box[3], lat);
    }
    boxes.push(box);
    if (!box.every(Number.isFinite)) return;
    extent[0] = Math.min(extent[0], box[0]);
    extent[1] = Math.min(extent[1], box[1]);
    extent[2] = Math.max(extent[2], box[2]);
    extent[3] = Math.max(extent[3], box[3]);
    for (let x = Math.floor(box[0] / CELL_SIZE); x <= Math.floor(box[2] / CELL_SIZE); x++) {
      for (let y = Math.floor(box[1] / CELL_SIZE); y <= Math.floor(box[3] / CELL_SIZE); y++) {
        const key = `${x}:${y}`;
        const bucket = cells.get(key);
        if (bucket) bucket.push(index);
        else cells.set(key, [index]);
      }
    }
  });
  let coverage: TrafficBounds | null = null;
  let selected: number[] = [];

  return {
    select(bounds: TrafficBounds) {
      if (!bounds.every(Number.isFinite) || bounds[0] > bounds[2] || bounds[1] > bounds[3]) return selected;
      const width = Math.max(bounds[2] - bounds[0], 0.0001);
      const height = Math.max(bounds[3] - bounds[1], 0.0001);
      if (coverage && bounds[0] >= coverage[0] && bounds[1] >= coverage[1] && bounds[2] <= coverage[2] && bounds[3] <= coverage[3] && (coverage[2] - coverage[0]) * (coverage[3] - coverage[1]) <= width * height * 8) return selected;
      coverage = [bounds[0] - width * 0.4, bounds[1] - height * 0.4, bounds[2] + width * 0.4, bounds[3] + height * 0.4];
      const found = new Set<number>();
      for (let x = Math.floor(Math.max(coverage[0], extent[0]) / CELL_SIZE); x <= Math.floor(Math.min(coverage[2], extent[2]) / CELL_SIZE); x++) {
        for (let y = Math.floor(Math.max(coverage[1], extent[1]) / CELL_SIZE); y <= Math.floor(Math.min(coverage[3], extent[3]) / CELL_SIZE); y++) {
          for (const index of cells.get(`${x}:${y}`) ?? []) if (intersects(boxes[index], coverage)) found.add(index);
        }
      }
      const next = [...found].sort((a, b) => a - b);
      if (next.length !== selected.length || next.some((index, position) => index !== selected[position])) selected = next;
      return selected;
    },
  };
}
