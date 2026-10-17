"use client";

import { useEffect, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import GlassSurface from "./glass-surface";

type ControlMap = Pick<MapboxMap | MapLibreMap, "getZoom" | "getMinZoom" | "getMaxZoom" | "getBearing" | "zoomIn" | "zoomOut" | "easeTo"> & {
  on: (event: "move", listener: () => void) => unknown;
  off: (event: "move", listener: () => void) => unknown;
};

function duration() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 250;
}

export default function MapControls({ map, is3D, onViewChange }: { map: ControlMap | null; is3D: boolean; onViewChange: (is3D: boolean) => void }) {
  const [camera, setCamera] = useState({ canZoomIn: true, canZoomOut: true, bearing: 0 });

  useEffect(() => {
    if (!map) return;
    const update = () => {
      const next = {
        canZoomIn: map.getZoom() < map.getMaxZoom() - 0.001,
        canZoomOut: map.getZoom() > map.getMinZoom() + 0.001,
        bearing: Math.round(map.getBearing()),
      };
      setCamera((previous) => previous.canZoomIn === next.canZoomIn && previous.canZoomOut === next.canZoomOut && previous.bearing === next.bearing ? previous : next);
    };
    update();
    map.on("move", update);
    return () => { map.off("move", update); };
  }, [map]);

  return (
    <>
      <div className="map-view-controls" data-map-ui>
        <GlassSurface variant="view">
          <div className="map-view-toggle" role="group" aria-label="Map view">
            <button type="button" aria-pressed={!is3D} disabled={!map} onClick={() => onViewChange(false)}>2D</button>
            <button type="button" aria-pressed={is3D} disabled={!map} onClick={() => onViewChange(true)}>3D</button>
          </div>
        </GlassSurface>
      </div>
      <div className="map-navigation-controls" data-map-ui>
        <GlassSurface variant="navigation">
          <div className="map-zoom-controls" role="group" aria-label="Map navigation">
            <button type="button" aria-label="Zoom in" title="Zoom in" disabled={!map || !camera.canZoomIn} onClick={() => map?.zoomIn({ duration: duration() })}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>
            </button>
            <button type="button" aria-label="Zoom out" title="Zoom out" disabled={!map || !camera.canZoomOut} onClick={() => map?.zoomOut({ duration: duration() })}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
            </button>
            <button type="button" aria-label="Reset map bearing to north" title="Reset north" disabled={!map} onClick={() => map?.easeTo({ bearing: 0, duration: duration() })}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ transform: `rotate(${-camera.bearing}deg)` }} aria-hidden="true"><path d="m12 3 5 9H7z" fill="currentColor" /><path d="m12 21-5-9h10z" fill="currentColor" opacity="0.3" /></svg>
            </button>
          </div>
        </GlassSurface>
      </div>
    </>
  );
}
