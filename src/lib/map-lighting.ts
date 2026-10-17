import type { Map as MapboxMap } from "mapbox-gl";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { mapboxBasemapConfig, MAP_NIGHT_PALETTE, MAP_PALETTE } from "./map-theme";
import { TORONTO_FADE_IMAGE, TORONTO_MASK_COLOR, TORONTO_NIGHT_FADE_IMAGE, TORONTO_NIGHT_MASK_COLOR } from "./city-boundary-presentation";
import type { SimulatorTheme } from "./simulator-theme";

type ThemeMap = Pick<MapLibreMap, "getStyle" | "getPaintProperty" | "setPaintProperty">;
type PaintProperty = Parameters<MapLibreMap["getPaintProperty"]>[1];
type PaintValue = Parameters<MapLibreMap["setPaintProperty"]>[2];
type PaintChange = { id: string; property: PaintProperty; day: PaintValue; night: PaintValue };
type BoundaryMap = {
  getLayer: (id: string) => unknown;
  getCanvas: () => HTMLCanvasElement;
  getSource: (id: string) => { type: string; updateImage?: (options: { url: string }) => unknown } | undefined;
  setPaintProperty: (id: string, property: "fill-color", value: string) => unknown;
};

function nightBuildings(): ExpressionSpecification {
  return ["interpolate", ["linear"], ["to-number", ["get", "render_height"], 6], 0, "#263b4e", 25, "#2e485f", 80, "#35536c", 200, "#3c607b", 350, "#4a718d"];
}

export function createMapLibreLighting(map: ThemeMap) {
  const changes: PaintChange[] = [];
  const palette = MAP_NIGHT_PALETTE;
  const add = (id: string, property: PaintProperty, night: PaintValue) => changes.push({ id, property, night, day: map.getPaintProperty(id, property) });
  for (const layer of map.getStyle()?.layers ?? []) {
    if (/^(disruption-|traffic-|outside-toronto|toronto-boundary)/.test(layer.id)) continue;
    const source = "source-layer" in layer ? layer["source-layer"] : "";
    if (layer.type === "background") add(layer.id, "background-color", palette.land);
    if (layer.type === "fill") {
      const color = source === "water" ? palette.water : source === "park" || source === "landcover" ? palette.greenspace : source === "building" ? nightBuildings() : palette.land;
      add(layer.id, "fill-color", color);
      if (source === "building") add(layer.id, "fill-outline-color", "#3c5a71");
    }
    if (layer.type === "line") {
      if (source === "waterway") add(layer.id, "line-color", palette.water);
      else if (source === "transportation") {
        const major = /motorway|trunk/.test(layer.id);
        const color = layer.id.includes("casing") ? "#223849" : /path|rail|ferry|cable|pier/.test(layer.id) ? "#365465" : major ? palette.motorways : /primary|secondary|link/.test(layer.id) ? palette.trunks : palette.roads;
        add(layer.id, "line-color", color);
      } else add(layer.id, "line-color", "#38526a");
    }
    if (layer.type === "symbol" && layer.layout?.["text-field"]) {
      add(layer.id, "text-color", source === "transportation_name" ? palette.roadLabels : palette.placeLabels);
      add(layer.id, "text-halo-color", palette.land);
    }
    if (layer.id === "toronto-3d-buildings") add(layer.id, "fill-extrusion-color", nightBuildings());
  }
  return (theme: SimulatorTheme) => {
    for (const change of changes) map.setPaintProperty(change.id, change.property, change[theme]);
  };
}

export function createMapLighting(map: MapboxMap | MapLibreMap, renderer: "mapbox" | "maplibre") {
  const applyFallback = renderer === "maplibre" ? createMapLibreLighting(map as MapLibreMap) : null;
  let current: SimulatorTheme | null = null;
  return (theme: SimulatorTheme) => {
    if (theme === current) return;
    current = theme;
    if (renderer === "mapbox") {
      const mapbox = map as MapboxMap;
      const colors = Object.fromEntries(Object.entries(mapboxBasemapConfig(theme)).filter(([property]) => property === "lightPreset" || property.startsWith("color")));
      mapbox.setConfig("basemap", { ...mapbox.getConfig("basemap"), ...colors });
    } else applyFallback?.(theme);
    const night = theme === "night";
    const boundary: BoundaryMap = map;
    if (boundary.getLayer("outside-toronto-mask")) boundary.setPaintProperty("outside-toronto-mask", "fill-color", night ? TORONTO_NIGHT_MASK_COLOR : TORONTO_MASK_COLOR);
    const source = boundary.getSource("toronto-boundary-fade");
    if (source?.type === "image") source.updateImage?.({ url: night ? TORONTO_NIGHT_FADE_IMAGE : TORONTO_FADE_IMAGE });
    map.getCanvas().style.backgroundColor = night ? MAP_NIGHT_PALETTE.land : MAP_PALETTE.land;
  };
}
