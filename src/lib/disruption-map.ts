import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";

export type DisruptionMap = Pick<MapboxMap | MapLibreMap, "getCanvas" | "getStyle" | "getZoom" | "getPitch" | "triggerRepaint" | "addSource" | "addLayer" | "getLayer" | "removeLayer" | "removeSource" | "queryRenderedFeatures" | "project" | "unproject" | "fitBounds"> & {
  getSource: (id: string) => ReturnType<MapboxMap["getSource"]> | ReturnType<MapLibreMap["getSource"]>;
  setPaintProperty: (id: string, property: "line-opacity", value: number) => unknown;
  on: (event: "move" | "resize", listener: () => void) => unknown;
  off: (event: "move" | "resize", listener: () => void) => unknown;
};

export function setDisruptionData(map: DisruptionMap, id: string, data: FeatureCollection) {
  const source = map.getSource(id);
  if (source?.type === "geojson" && "setData" in source && typeof source.setData === "function") source.setData(data);
}
