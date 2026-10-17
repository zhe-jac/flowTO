import type { Map as MapboxMap } from "mapbox-gl";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { blendValue, type SimulatorLight } from "./daylight";
import { mapboxBasemapColors, MAP_NIGHT_PALETTE, MAP_PALETTE } from "./map-theme";
import { TORONTO_FADE_IMAGE, TORONTO_MASK_COLOR, TORONTO_NIGHT_FADE_IMAGE, TORONTO_NIGHT_MASK_COLOR } from "./city-boundary-presentation";

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
  // Colours blend through dawn and dusk; expressions and other values switch halfway.
  return (daylight: number) => {
    for (const change of changes) map.setPaintProperty(change.id, change.property, blendValue(change.night, change.day, daylight) as PaintValue);
  };
}

export function createMapLighting(map: MapboxMap | MapLibreMap, renderer: "mapbox" | "maplibre") {
  const applyFallback = renderer === "maplibre" ? createMapLibreLighting(map as MapLibreMap) : null;
  let current = "";
  return (light: SimulatorLight) => {
    const key = `${light.phase}:${light.daylight}`;
    if (key === current) return;
    current = key;
    const { daylight } = light;
    if (renderer === "mapbox") {
      // Standard switches light presets instantly, so it steps night → dawn → day → dusk while the colours blend.
      const mapbox = map as MapboxMap;
      const current = mapbox.getConfig("basemap") ?? {};
      const next: Record<string, unknown> = { lightPreset: light.phase, ...mapboxBasemapColors(daylight) };
      // Only send settings that changed, so each dawn/dusk step re-evaluates as little of the style as possible.
      if (Object.entries(next).some(([property, value]) => current[property] !== value)) mapbox.setConfig("basemap", { ...current, ...next });
      // The Toronto-only street names are a custom layer, so they blend with the light separately.
      if (mapbox.getLayer("toronto-road-labels")) {
        mapbox.setPaintProperty("toronto-road-labels", "text-color", blendValue(MAP_NIGHT_PALETTE.roadLabels, MAP_PALETTE.roadLabels, daylight));
        mapbox.setPaintProperty("toronto-road-labels", "text-halo-color", blendValue(MAP_NIGHT_PALETTE.land, "#ffffff", daylight));
      }
    } else applyFallback?.(daylight);
    const boundary: BoundaryMap = map;
    if (boundary.getLayer("outside-toronto-mask")) boundary.setPaintProperty("outside-toronto-mask", "fill-color", blendValue(TORONTO_NIGHT_MASK_COLOR, TORONTO_MASK_COLOR, daylight));
    const source = boundary.getSource("toronto-boundary-fade");
    if (source?.type === "image") source.updateImage?.({ url: light.theme === "night" ? TORONTO_NIGHT_FADE_IMAGE : TORONTO_FADE_IMAGE });
    map.getCanvas().style.backgroundColor = blendValue(MAP_NIGHT_PALETTE.land, MAP_PALETTE.land, daylight);
  };
}
