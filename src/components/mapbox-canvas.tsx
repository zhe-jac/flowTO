"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { MAP_NIGHT_PALETTE, MAP_PALETTE, mapboxBasemapConfig } from "@/lib/map-theme";
import { initialTrafficClock } from "@/lib/traffic/clock";
import { simulatorTheme } from "@/lib/simulator-theme";
import { BOUNDARY_ATTRIBUTION, createOutsideMask, restrictCameraToToronto, TORONTO_BOUNDARY, TORONTO_BOUNDS, TORONTO_MIN_ZOOM } from "@/lib/city-boundary";
import { is3DPitch } from "@/lib/map-view";
import { TORONTO_DISTANT_MASK, TORONTO_FADE_COORDINATES, TORONTO_FADE_IMAGE, TORONTO_MASK_COLOR, TORONTO_NIGHT_FADE_IMAGE, TORONTO_NIGHT_MASK_COLOR } from "@/lib/city-boundary-presentation";
import MapWorkspace from "./map-workspace";
import MapControls from "./map-controls";

export default function MapboxCanvas({ accessToken }: { accessToken: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const [status, setStatus] = useState("Loading Mapbox Standard…");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const is3DRef = useRef(false);
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
        const theme = simulatorTheme(initialTrafficClock(window.location.search).minutes);

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
            basemap: mapboxBasemapConfig(theme),
          },
        });

        mapRef.current = map;
        releaseBoundary = restrictCameraToToronto(map);
        map.addControl(new mapboxgl.AttributionControl({ compact: false }), "bottom-right");
        map.on("load", () => {
          if (disposed || !map) return;
          map.addSource("outside-toronto", { type: "geojson", data: TORONTO_DISTANT_MASK, attribution: BOUNDARY_ATTRIBUTION, tolerance: 0 });
          map.addSource("toronto-boundary-fade", { type: "image", url: theme === "night" ? TORONTO_NIGHT_FADE_IMAGE : TORONTO_FADE_IMAGE, coordinates: TORONTO_FADE_COORDINATES });
          // Clip labels and 3D objects with the exact city boundary (the visible mask starts further out, behind a fade).
          map.addSource("outside-toronto-exact", { type: "geojson", data: createOutsideMask(TORONTO_BOUNDARY.geometry), tolerance: 0 });
          map.addLayer({
            id: "outside-toronto-clip",
            type: "clip",
            source: "outside-toronto-exact",
            layout: { "clip-layer-types": ["symbol", "model"], "clip-layer-scope": ["basemap"] },
          });
          map.addLayer({
            id: "outside-toronto-mask",
            type: "fill",
            source: "outside-toronto",
            paint: { "fill-color": theme === "night" ? TORONTO_NIGHT_MASK_COLOR : TORONTO_MASK_COLOR, "fill-opacity": 1, "fill-emissive-strength": 1, "fill-antialias": false },
          });
          map.addLayer({
            id: "toronto-boundary-fade",
            type: "raster",
            source: "toronto-boundary-fade",
            paint: { "raster-fade-duration": 0, "raster-resampling": "linear", "raster-emissive-strength": 1 },
          });
          // Standard's road labels and highway shields ignore clip layers, so they are off in the basemap config and
          // street names are drawn here, limited to roads inside Toronto.
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
              "text-color": theme === "night" ? MAP_NIGHT_PALETTE.roadLabels : MAP_PALETTE.roadLabels,
              "text-halo-color": theme === "night" ? MAP_NIGHT_PALETTE.land : "#ffffff",
              "text-halo-width": 1.4,
              "text-emissive-strength": 1,
            },
          });
          // Tilting with two fingers (or ctrl-drag) switches into the 3D view; flattening returns to 2D.
          map.on("pitchend", () => {
            if (!map) return;
            const next = is3DPitch(map.getPitch(), is3DRef.current);
            if (next === is3DRef.current) return;
            is3DRef.current = next;
            map.setConfigProperty("basemap", "show3dObjects", next);
            setIs3D(next);
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
    is3DRef.current = nextIs3D;
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
      <MapControls map={ready ? mapRef.current : null} is3D={is3D} onViewChange={changeView} />
      {ready && mapRef.current ? <MapWorkspace map={mapRef.current} renderer="mapbox" /> : null}
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
