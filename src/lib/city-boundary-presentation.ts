import type { Feature, MultiPolygon } from "geojson";
import fade from "./data/toronto-boundary-fade.json";
import type { Coordinate } from "./city-boundary";

export const TORONTO_FADE_IMAGE = "/data/toronto-boundary-fade.png";
export const TORONTO_NIGHT_FADE_IMAGE = "/data/toronto-boundary-fade-night.png";
export const TORONTO_FADE_COORDINATES = fade.coordinates as [Coordinate, Coordinate, Coordinate, Coordinate];
export const TORONTO_DISTANT_MASK = fade.outside as Feature<MultiPolygon>;
export const TORONTO_MASK_COLOR = "#dfeef7";
export const TORONTO_NIGHT_MASK_COLOR = "#101d2b";
