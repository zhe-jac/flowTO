import { readFile, writeFile } from "node:fs/promises";
import buffer from "@turf/buffer";
import sharp from "sharp";
import type { Feature, MultiPolygon, Position } from "geojson";
import { createOutsideMask } from "../src/lib/city-boundary";
import { TORONTO_NIGHT_MASK_COLOR } from "../src/lib/city-boundary-presentation";

const boundary = JSON.parse(await readFile("src/lib/data/toronto-boundary.json", "utf8")) as Feature<MultiPolygon>;
const buffered = buffer(boundary, 0.9, { units: "kilometers", steps: 12 });
if (!buffered) throw new Error("Could not build the boundary fade");

const radius = 6378137;
const project = ([lng, lat]: Position) => [radius * lng * Math.PI / 180, radius * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
const unproject = ([x, y]: number[]) => [x / radius * 180 / Math.PI, (2 * Math.atan(Math.exp(y / radius)) - Math.PI / 2) * 180 / Math.PI];
const points = boundary.geometry.coordinates.flat(2).map(project);
const bounds = points.reduce((result, point) => [Math.min(result[0], point[0]), Math.min(result[1], point[1]), Math.max(result[2], point[0]), Math.max(result[3], point[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const padding = 4500;
const west = bounds[0] - padding;
const south = bounds[1] - padding;
const east = bounds[2] + padding;
const north = bounds[3] + padding;
const width = 2048;
const scale = width / (east - west);
const height = Math.ceil((north - south) * scale);
const pixel = (point: Position) => {
  const [x, y] = project(point);
  return `${((x - west) * scale).toFixed(3)},${((north - y) * scale).toFixed(3)}`;
};
const polygons = buffered.geometry.type === "Polygon" ? [buffered.geometry.coordinates] : buffered.geometry.coordinates;
const path = polygons.flatMap((polygon) => polygon.map((ring) => `M${ring.map(pixel).join("L")}Z`)).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/><path d="${path}" fill="black" fill-rule="evenodd"/></svg>`;
const mercatorScale = 1 / Math.cos(43.7 * Math.PI / 180);
const pixels = await sharp(Buffer.from(svg)).removeAlpha().greyscale().blur(300 * mercatorScale * scale).raw().toBuffer();
const rgba = Buffer.alloc(width * height * 4);
for (let index = 0; index < pixels.length; index++) {
  const alpha = pixels[index] <= 2 ? 0 : pixels[index] >= 253 ? 255 : pixels[index];
  rgba[index * 4] = 223;
  rgba[index * 4 + 1] = 238;
  rgba[index * 4 + 2] = 247;
  rgba[index * 4 + 3] = alpha;
}

const coordinates = [[west, north], [east, north], [east, south], [west, south]].map(unproject);
const outside = createOutsideMask({ type: "Polygon", coordinates: [[...coordinates.slice().reverse(), coordinates[3]]] });
await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toFile("public/data/toronto-boundary-fade.png");
const night = Buffer.from(rgba);
const nightColor = TORONTO_NIGHT_MASK_COLOR.slice(1).match(/../g)!.map((channel) => parseInt(channel, 16));
for (let index = 0; index < pixels.length; index++) {
  night[index * 4] = nightColor[0];
  night[index * 4 + 1] = nightColor[1];
  night[index * 4 + 2] = nightColor[2];
}
await sharp(night, { raw: { width, height, channels: 4 } }).png().toFile("public/data/toronto-boundary-fade-night.png");
await writeFile("src/lib/data/toronto-boundary-fade.json", JSON.stringify({ coordinates, outside }));
console.log(JSON.stringify({ fade: "public/data/toronto-boundary-fade.png", width, height }));
