"use client";
import { useEffect } from "react";
import type { FeatureCollection, LineString } from "geojson";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
export type LocationPreviewData = FeatureCollection<LineString>;
export default function LocationPreview({ map, data }: { map: MapboxMap | MapLibreMap; data: LocationPreviewData | null }) {
  useEffect(() => {
    if (!data?.features.length) return;
    const source = "assistant-location-preview";
    const outline = `${source}-outline`, line = `${source}-line`;
    map.addSource(source, { type: "geojson", data });
    map.addLayer({ id: outline, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9 } });
    map.addLayer({ id: line, type: "line", source, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#218dd5", "line-width": 5, "line-opacity": 0.95 } });
    const points = data.features.flatMap(feature => feature.geometry.coordinates);
    const bounds: [[number, number], [number, number]] = [[Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))], [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]];
    map.fitBounds(bounds, { padding: 90, maxZoom: 16, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450 });
    return () => {
      if (map.getLayer(line)) map.removeLayer(line);
      if (map.getLayer(outline)) map.removeLayer(outline);
      if (map.getStyle()?.sources[source]) map.removeSource(source);
    };
  }, [map, data]);
  return null;
}
