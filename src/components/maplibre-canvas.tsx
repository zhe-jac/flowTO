"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { openFreeMapBuildings, type BuildingSource } from "@/components/traffic/building-layers";
import TrafficOverlay, { type OverlayPlacement } from "@/components/traffic/traffic-overlay";
import { MAP_PALETTE } from "@/lib/map-theme";
import { BOUNDARY_ATTRIBUTION, OUTSIDE_TORONTO_MASK, restrictCameraToToronto, TORONTO_BOUNDARY, TORONTO_BOUNDS, TORONTO_MIN_ZOOM } from "@/lib/city-boundary";

const BUILDING_COLOR: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["to-number", ["get", "render_height"], 6],
  0, "#e4f1fa",
  25, "#d0e7f6",
  80, "#bddcf0",
  200, "#a6cce5",
  350, "#8bb7d4",
];

export default function MapLibreCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [status, setStatus] = useState("Loading Toronto map…");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [traffic, setTraffic] = useState<{ map: MapLibreMap; placement: OverlayPlacement; loadBuildings: () => Promise<BuildingSource> } | null>(null);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let releaseBoundary: (() => void) | undefined;

    async function initialize() {
      try {
        const { Map, NavigationControl, setWorkerUrl } = await import("maplibre-gl");
        if (disposed || !containerRef.current) return;

        setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).toString());

        map = new Map({
          container: containerRef.current,
          style: "https://tiles.openfreemap.org/styles/bright",
          center: [-79.3832, 43.6532],
          zoom: 13,
          minZoom: TORONTO_MIN_ZOOM,
          maxBounds: TORONTO_BOUNDS,
          renderWorldCopies: false,
          pitch: 0,
          bearing: 0,
          attributionControl: { compact: false },
          canvasContextAttributes: { antialias: true },
        });

        mapRef.current = map;
        releaseBoundary = restrictCameraToToronto(map);
        map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");
        map.on("load", () => {
          if (disposed || !map) return;
          for (const layer of map.getStyle().layers) {
            const sourceLayer = "source-layer" in layer ? layer["source-layer"] : null;
            if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", MAP_PALETTE.land);
            if (layer.type === "fill" && sourceLayer === "water") map.setPaintProperty(layer.id, "fill-color", MAP_PALETTE.water);
            if (layer.type === "fill" && sourceLayer === "park") map.setPaintProperty(layer.id, "fill-color", MAP_PALETTE.greenspace);
            // Neutral road colours keep yellow/orange/red reserved for traffic conditions.
            if (layer.type === "line" && sourceLayer === "transportation" && !/path|rail|ferry|cable|pier/.test(layer.id)) {
              const major = /motorway|trunk/.test(layer.id);
              const color = layer.id.includes("casing") ? (major ? "#b4cde0" : "#cddfeb")
                : major ? MAP_PALETTE.motorways
                : /primary|secondary|link/.test(layer.id) ? MAP_PALETTE.trunks
                : MAP_PALETTE.roads;
              map.setPaintProperty(layer.id, "line-color", color);
            }
          }
          if (map.getLayer("building")) {
            map.setPaintProperty("building", "fill-color", BUILDING_COLOR);
            map.setPaintProperty("building", "fill-outline-color", "#a5c8df");
          }
          const labelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"]);
          // 3D buildings are drawn by the traffic overlay, which can make individual tall buildings see-through.
          map.addSource("toronto-boundary", { type: "geojson", data: TORONTO_BOUNDARY, attribution: BOUNDARY_ATTRIBUTION, tolerance: 0 });
          map.addSource("outside-toronto", { type: "geojson", data: OUTSIDE_TORONTO_MASK, tolerance: 0 });
          map.addLayer({
            id: "outside-toronto-mask",
            type: "fill",
            source: "outside-toronto",
            paint: { "fill-color": "#dfeef7", "fill-opacity": 1 },
          });
          map.addLayer({
            id: "toronto-city-outline",
            type: "line",
            source: "toronto-boundary",
            paint: { "line-color": "#78a9c8", "line-width": 1.5, "line-opacity": 0.85 },
          });
          setReady(true);
          setTraffic({ map, placement: { beforeId: labelLayer?.id }, loadBuildings: openFreeMapBuildings });
          setStatus("");
          setError(null);
        });
        map.on("error", (event) => {
          if (disposed) return;
          console.error("Toronto map:", event.error);
          setStatus("");
          setError(event.error.message || "The map could not load. Check your internet connection.");
        });

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
        map.resize();
      } catch (cause) {
        if (disposed) return;
        console.error("Toronto map initialization:", cause);
        setStatus("");
        setError(cause instanceof Error ? cause.message : "The map could not start in this browser.");
      }
    }

    void initialize();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      releaseBoundary?.();
      setTraffic(null);
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  function changeView(nextIs3D: boolean) {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.easeTo({
      pitch: nextIs3D ? 55 : 0,
      bearing: nextIs3D ? -20 : 0,
      zoom: nextIs3D ? Math.max(map.getZoom(), 15.5) : map.getZoom(),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900,
    });
    setIs3D(nextIs3D);
  }

  return (
    <main className="map-page" aria-label="Toronto street map">
      <div ref={containerRef} className="map-container" />
      {traffic ? <TrafficOverlay {...traffic} /> : null}
      <div className="map-view-toggle" role="group" aria-label="Map view">
        <button type="button" aria-pressed={!is3D} disabled={!ready} onClick={() => changeView(false)}>2D</button>
        <button type="button" aria-pressed={is3D} disabled={!ready} onClick={() => changeView(true)}>3D</button>
      </div>
      {status ? <p className="map-message" role="status">{status}</p> : null}
      {error ? (
        <div className="map-message map-error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()}>Reload map</button>
        </div>
      ) : null}
    </main>
  );
}
