"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { MAPBOX_BASEMAP_CONFIG } from "@/lib/map-theme";
import { BOUNDARY_ATTRIBUTION, restrictCameraToToronto, TORONTO_BOUNDS, TORONTO_MIN_ZOOM } from "@/lib/city-boundary";
import { TORONTO_DISTANT_MASK, TORONTO_FADE_COORDINATES, TORONTO_FADE_IMAGE, TORONTO_MASK_COLOR } from "@/lib/city-boundary-presentation";
import ClosureToolbox from "./closure-toolbox";

export default function MapboxCanvas({ accessToken }: { accessToken: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [status, setStatus] = useState("Loading Mapbox Standard…");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [is3D, setIs3D] = useState(false);

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
          map.addSource("outside-toronto", { type: "geojson", data: TORONTO_DISTANT_MASK, attribution: BOUNDARY_ATTRIBUTION, tolerance: 0 });
          map.addSource("toronto-boundary-fade", { type: "image", url: TORONTO_FADE_IMAGE, coordinates: TORONTO_FADE_COORDINATES });
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
            paint: { "fill-color": TORONTO_MASK_COLOR, "fill-opacity": 1, "fill-emissive-strength": 1, "fill-antialias": false },
          });
          map.addLayer({
            id: "toronto-boundary-fade",
            type: "raster",
            source: "toronto-boundary-fade",
            paint: { "raster-fade-duration": 0, "raster-resampling": "linear", "raster-emissive-strength": 1 },
          });
          setReady(true);
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
      map?.remove();
      mapRef.current = null;
    };
  }, [accessToken]);

  function changeView(nextIs3D: boolean) {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.setConfigProperty("basemap", "show3dObjects", nextIs3D);
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
      <div className="map-view-toggle" role="group" aria-label="Map view" data-map-ui>
        <button type="button" aria-pressed={!is3D} disabled={!ready} onClick={() => changeView(false)}>2D</button>
        <button type="button" aria-pressed={is3D} disabled={!ready} onClick={() => changeView(true)}>3D</button>
      </div>
      {ready && mapRef.current ? <ClosureToolbox map={mapRef.current} /> : null}
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
