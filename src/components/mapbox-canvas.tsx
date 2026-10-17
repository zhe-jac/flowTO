"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { MAPBOX_BUILDINGS, type BuildingSource } from "@/components/traffic/building-layers";
import TrafficOverlay, { type OverlayPlacement } from "@/components/traffic/traffic-overlay";
import { MAP_PALETTE, MAPBOX_BASEMAP_CONFIG } from "@/lib/map-theme";
import { BOUNDARY_ATTRIBUTION, OUTSIDE_TORONTO_MASK, restrictCameraToToronto, TORONTO_BOUNDARY, TORONTO_BOUNDS, TORONTO_MIN_ZOOM } from "@/lib/city-boundary";

export default function MapboxCanvas({ accessToken }: { accessToken: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [status, setStatus] = useState("Loading Mapbox Standard…");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [is3D, setIs3D] = useState(false);
  const [traffic, setTraffic] = useState<{ map: MapboxMap; placement: OverlayPlacement; loadBuildings: () => Promise<BuildingSource> } | null>(null);

  useEffect(() => {
    let map: MapboxMap | undefined;
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let releaseBoundary: (() => void) | undefined;

    async function initialize() {
      try {
        const { default: mapboxgl } = await import("mapbox-gl");
        if (disposed || !containerRef.current) return;

        map = new mapboxgl.Map({
          container: containerRef.current,
          accessToken,
          style: "mapbox://styles/mapbox/standard",
          center: [-79.3832, 43.6532],
          zoom: 13,
          minZoom: TORONTO_MIN_ZOOM,
          maxBounds: TORONTO_BOUNDS,
          renderWorldCopies: false,
          projection: "mercator",
          pitch: 0,
          bearing: 0,
          antialias: true,
          attributionControl: false,
          config: {
            basemap: MAPBOX_BASEMAP_CONFIG,
          },
        });

        mapRef.current = map;
        releaseBoundary = restrictCameraToToronto(map);
        map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");
        map.addControl(new mapboxgl.AttributionControl({ compact: false }), "bottom-right");
        map.on("load", () => {
          if (disposed || !map) return;
          map.addSource("toronto-boundary", { type: "geojson", data: TORONTO_BOUNDARY, attribution: BOUNDARY_ATTRIBUTION, tolerance: 0 });
          map.addSource("outside-toronto", { type: "geojson", data: OUTSIDE_TORONTO_MASK, tolerance: 0 });
          map.addLayer({
            id: "outside-toronto-clip",
            type: "clip",
            source: "outside-toronto",
            layout: { "clip-layer-types": ["symbol", "model"], "clip-layer-scope": ["basemap"] },
          });
          map.addLayer({
            id: "outside-toronto-mask",
            type: "fill",
            source: "outside-toronto",
            paint: { "fill-color": "#dfeef7", "fill-opacity": 1, "fill-emissive-strength": 1 },
          });
          map.addLayer({
            id: "toronto-city-outline",
            type: "line",
            source: "toronto-boundary",
            paint: { "line-color": "#78a9c8", "line-width": 1.5, "line-opacity": 0.85 },
          });
          // Standard's road labels include highway shields that ignore the clip layer, so they are turned off in the
          // basemap config and street names are drawn here, limited to roads inside Toronto.
          map.addSource("streets", { type: "vector", url: "mapbox://mapbox.mapbox-streets-v8" });
          map.addLayer({
            id: "toronto-road-labels",
            type: "symbol",
            source: "streets",
            "source-layer": "road",
            slot: "top",
            minzoom: 12,
            filter: ["all", ["has", "name"], ["!", ["match", ["get", "class"], ["path", "pedestrian", "service", "track", "major_rail", "minor_rail"], true, false]], ["within", TORONTO_BOUNDARY]],
            layout: {
              "symbol-placement": "line",
              "text-field": ["get", "name"],
              "text-font": ["DIN Pro Medium", "Arial Unicode MS Regular"],
              "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 16, 13, 18, 15],
              "text-max-angle": 30,
              "text-padding": 2,
            },
            paint: {
              "text-color": MAP_PALETTE.roadLabels,
              "text-halo-color": "#ffffff",
              "text-halo-width": 1.4,
              "text-emissive-strength": 1,
            },
          });
          setReady(true);
          // Standard's own 3D buildings stay off: the overlay draws buildings so tall ones can turn see-through individually.
          const buildings = MAPBOX_BUILDINGS(accessToken);
          setTraffic({ map, placement: { slot: "middle" }, loadBuildings: () => Promise.resolve(buildings) });
          setStatus("");
          setError(null);
        });
        map.on("error", (event) => {
          if (disposed) return;
          const failedRequest = event.error as Error & { status?: number };
          setStatus("");
          if (failedRequest.status === 401 || failedRequest.status === 403) {
            setError("Mapbox rejected the request. Check that your public access token is valid and allows this site's URL.");
          } else {
            setError("Mapbox could not load. Check your connection and access token, then reload the map.");
          }
        });

        resizeObserver = new ResizeObserver(() => map?.resize());
        resizeObserver.observe(containerRef.current);
        map.resize();
      } catch (cause) {
        if (disposed) return;
        setStatus("");
        setError(cause instanceof Error ? cause.message : "Mapbox could not start in this browser.");
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
  }, [accessToken]);

  function changeView(nextIs3D: boolean) {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.easeTo({
      pitch: nextIs3D ? 60 : 0,
      bearing: nextIs3D ? -20 : 0,
      zoom: nextIs3D ? Math.max(map.getZoom(), 15.5) : map.getZoom(),
      duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 900,
    });
    setIs3D(nextIs3D);
  }

  return (
    <main className="map-page" aria-label="Toronto street map with Mapbox Standard">
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
