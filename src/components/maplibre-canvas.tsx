"use client";

import { useEffect, useRef, useState } from "react";
import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { MAP_PALETTE } from "@/lib/map-theme";
import { BOUNDARY_ATTRIBUTION, restrictCameraToToronto, TORONTO_BOUNDARY, TORONTO_BOUNDS, TORONTO_MIN_ZOOM } from "@/lib/city-boundary";
import { is3DPitch } from "@/lib/map-view";
import { TORONTO_DISTANT_MASK, TORONTO_FADE_COORDINATES, TORONTO_FADE_IMAGE, TORONTO_MASK_COLOR } from "@/lib/city-boundary-presentation";
import MapWorkspace from "./map-workspace";
import MapControls from "./map-controls";

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
  const is3DRef = useRef(false);
  const [is3D, setIs3D] = useState(false);

  useEffect(() => {
    let map: MapLibreMap | undefined;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let releaseBoundary: (() => void) | undefined;

    async function initialize() {
      try {
        const { Map, setWorkerUrl } = await import("maplibre-gl");
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
        map.on("load", () => {
          if (disposed || !map) return;
          for (const layer of map.getStyle().layers) {
            const sourceLayer = "source-layer" in layer ? layer["source-layer"] : null;
            if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", MAP_PALETTE.land);
            if (layer.type === "fill" && sourceLayer === "water") map.setPaintProperty(layer.id, "fill-color", MAP_PALETTE.water);
            if (layer.type === "fill" && sourceLayer === "park") map.setPaintProperty(layer.id, "fill-color", MAP_PALETTE.greenspace);
            if (layer.type === "line" && sourceLayer === "transportation" && !/path|rail|ferry|cable|pier/.test(layer.id)) {
              const major = /motorway|trunk/.test(layer.id);
              const color = layer.id.includes("casing") ? (major ? "#b4cde0" : "#cddfeb") : major ? MAP_PALETTE.motorways : /primary|secondary|link/.test(layer.id) ? MAP_PALETTE.trunks : MAP_PALETTE.roads;
              map.setPaintProperty(layer.id, "line-color", color);
            }
          }
          if (map.getLayer("building")) {
            map.setPaintProperty("building", "fill-color", BUILDING_COLOR);
            map.setPaintProperty("building", "fill-outline-color", "#a5c8df");
          }
          // Labels and highway shields only appear for features inside Toronto.
          for (const layer of map.getStyle().layers) {
            if (layer.type !== "symbol" || !("source" in layer) || layer.source !== "openmaptiles") continue;
            const existing = map.getFilter(layer.id);
            map.setFilter(layer.id, (existing ? ["all", existing, ["within", TORONTO_BOUNDARY]] : ["within", TORONTO_BOUNDARY]) as ExpressionSpecification);
          }
          // Tilting with two fingers (or ctrl-drag) switches into the 3D view; flattening returns to 2D.
          map.on("pitchend", () => {
            if (!map) return;
            const next = is3DPitch(map.getPitch(), is3DRef.current);
            if (next === is3DRef.current) return;
            is3DRef.current = next;
            if (map.getLayer("toronto-3d-buildings")) map.setLayoutProperty("toronto-3d-buildings", "visibility", next ? "visible" : "none");
            setIs3D(next);
          });
          const labelLayer = map.getStyle().layers.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"]);
          map.addLayer({
            id: "toronto-3d-buildings",
            source: "openmaptiles",
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 14,
            filter: ["!=", ["get", "hide_3d"], true],
            layout: { visibility: "none" },
            paint: {
              "fill-extrusion-color": BUILDING_COLOR,
              "fill-extrusion-height": ["to-number", ["get", "render_height"], 6],
              "fill-extrusion-base": ["to-number", ["get", "render_min_height"], 0],
              "fill-extrusion-opacity": 0.92,
              "fill-extrusion-vertical-gradient": true,
            },
          }, labelLayer?.id);
          map.addSource("outside-toronto", { type: "geojson", data: TORONTO_DISTANT_MASK, attribution: BOUNDARY_ATTRIBUTION, tolerance: 0 });
          map.addSource("toronto-boundary-fade", { type: "image", url: TORONTO_FADE_IMAGE, coordinates: TORONTO_FADE_COORDINATES });
          map.addLayer({
            id: "outside-toronto-mask",
            type: "fill",
            source: "outside-toronto",
            paint: { "fill-color": TORONTO_MASK_COLOR, "fill-opacity": 1, "fill-antialias": false },
          });
          map.addLayer({
            id: "toronto-boundary-fade",
            type: "raster",
            source: "toronto-boundary-fade",
            paint: { "raster-fade-duration": 0, "raster-resampling": "linear" },
          });
          setReady(true);
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
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  function changeView(nextIs3D: boolean) {
    const map = mapRef.current;
    if (!map || !ready) return;
    is3DRef.current = nextIs3D;
    map.setLayoutProperty("toronto-3d-buildings", "visibility", nextIs3D ? "visible" : "none");
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
      <MapControls map={ready ? mapRef.current : null} is3D={is3D} onViewChange={changeView} />
      {ready && mapRef.current ? <MapWorkspace map={mapRef.current} renderer="maplibre" /> : null}
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
