"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { closureFeatures, nearestRoad } from "@/lib/closure-placement";
import type { RoadSnap, ScreenPoint } from "@/lib/closure-placement";
import type { Road, RoadCollection } from "@/lib/types";
import ToolboxGlassSurface from "./toolbox-glass-surface";

type ClosureMap = Pick<MapboxMap | MapLibreMap, "getCanvas" | "getStyle" | "getZoom" | "addSource" | "addLayer" | "getLayer" | "removeLayer" | "removeSource" | "queryRenderedFeatures" | "project" | "fitBounds"> & {
  getSource: (id: string) => ReturnType<MapboxMap["getSource"]> | ReturnType<MapLibreMap["getSource"]>;
  setPaintProperty: (id: string, property: "line-opacity", value: number) => unknown;
  on: (event: "move", listener: () => void) => unknown;
  off: (event: "move", listener: () => void) => unknown;
};
type Drag = { pointerId: number; start: ScreenPoint; moved: boolean };
type Ghost = ScreenPoint & { snapped: boolean; name: string; dragging: boolean; keyboard: boolean };
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["closure-roads", "closure-active", "closure-applied"];
const LAYERS = ["closure-road-guides", "closure-road-targets", "closure-applied-halo", "closure-applied-line", "closure-applied-stripes", "closure-applied-ends", "closure-active-halo", "closure-active-line", "closure-active-stripes", "closure-active-ends"];

function Icon({ kind }: { kind: "toolbox" | "barrier" | "close" | "arrow" }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "toolbox" ? <><path d="M8 7V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" /><rect x="3" y="7" width="18" height="13" rx="3" /><path d="M3 12h18M9 11v3m6-3v3" /></> : null}
      {kind === "barrier" ? <><path d="M5 16v5m14-5v5" /><rect x="2" y="6" width="20" height="10" rx="2" /><path d="m3 14 7-7m0 9L20 6m-1 10 3-3" /></> : null}
      {kind === "close" ? <path d="m6 6 12 12M6 18 18 6" /> : null}
      {kind === "arrow" ? <path d="m9 6 6 6-6 6" /> : null}
    </svg>
  );
}

function setData(map: ClosureMap, id: string, data: FeatureCollection) {
  const source = map.getSource(id);
  if (source?.type === "geojson" && "setData" in source && typeof source.setData === "function") source.setData(data);
}

export default function ClosureToolbox({ map }: { map: ClosureMap }) {
  const [open, setOpen] = useState(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const [armed, setArmed] = useState(false);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [draft, setDraft] = useState<Road | null>(null);
  const [closures, setClosures] = useState<Road[]>([]);
  const [notice, setNotice] = useState("");
  const roadsRef = useRef(new Map<string, Road>());
  const closuresRef = useRef<Road[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const armedRef = useRef(false);
  const keyboardRef = useRef(false);
  const hoverRef = useRef<RoadSnap | null>(null);
  const lastPointerRef = useRef<ScreenPoint | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const keyboardPlacementRef = useRef<() => void>(() => {});
  const placementButtonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLElement>(null);

  useEffect(() => {
    map.addSource("closure-roads", { type: "geojson", data: EMPTY, attribution: '<a href="https://open.toronto.ca/dataset/toronto-centreline-tcl/" target="_blank" rel="noopener noreferrer">Roads: City of Toronto</a>' });
    map.addLayer({ id: "closure-road-guides", type: "line", source: "closure-roads", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#397caa", "line-width": 2, "line-opacity": 0 } });
    map.addLayer({ id: "closure-road-targets", type: "line", source: "closure-roads", paint: { "line-width": 24, "line-opacity": 0 } });
    for (const kind of ["applied", "active"]) {
      const source = `closure-${kind}`;
      map.addSource(source, { type: "geojson", data: EMPTY });
      map.addLayer({ id: `${source}-halo`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffaf7", "line-width": 12, "line-opacity": 0.95 } });
      map.addLayer({ id: `${source}-line`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": kind === "active" ? "#ed8975" : "#da594b", "line-width": 7 } });
      map.addLayer({ id: `${source}-stripes`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": "#fffaf7", "line-width": 2, "line-dasharray": [2, 2] } });
      map.addLayer({ id: `${source}-ends`, type: "circle", source, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#fffaf7", "circle-stroke-color": "#da594b", "circle-stroke-width": 2 } });
    }
    return () => {
      if (!map.getStyle()) return;
      for (const id of LAYERS.slice().reverse()) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of SOURCES.slice().reverse()) if (map.getSource(id)) map.removeSource(id);
    };
  }, [map]);

  useEffect(() => {
    if (!open || roadsRef.current.size) return;
    const controller = new AbortController();
    setLoadState("loading");
    void fetch("/data/downtown-roads.geojson", { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Road data could not load");
      const data = await response.json() as RoadCollection;
      if (data.type !== "FeatureCollection" || !data.features?.length) throw new Error("Road data is empty");
      if (controller.signal.aborted) return;
      roadsRef.current = new Map(data.features.map((road) => [road.properties.id, road]));
      setData(map, "closure-roads", data);
      setLoadState("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setLoadState("error");
    });
    return () => controller.abort();
  }, [map, open, retry]);

  useEffect(() => {
    closuresRef.current = closures;
    setData(map, "closure-applied", closureFeatures(closures));
  }, [map, closures]);

  useEffect(() => {
    setData(map, "closure-active", closureFeatures(draft ? [draft] : []));
    if (draft) previewRef.current?.focus({ preventScroll: true });
  }, [map, draft]);

  useEffect(() => {
    const canvas = map.getCanvas();
    let frame = 0;
    let clickStart: ScreenPoint | null = null;
    const cancel = () => {
      cancelAnimationFrame(frame);
      dragRef.current = null;
      armedRef.current = false;
      keyboardRef.current = false;
      hoverRef.current = null;
      lastPointerRef.current = null;
      setArmed(false);
      setGhost(null);
      canvas.style.cursor = "";
      map.setPaintProperty("closure-road-guides", "line-opacity", 0);
      setData(map, "closure-active", EMPTY);
    };
    const snap = (client: ScreenPoint): RoadSnap | null => {
      const rect = canvas.getBoundingClientRect();
      const point = { x: client.x - rect.left, y: client.y - rect.top };
      const overControls = document.elementFromPoint(client.x, client.y)?.closest("[data-map-ui]");
      let result: RoadSnap | null = null;
      if (!overControls && map.getZoom() >= 12 && point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height) {
        const extent: [[number, number], [number, number]] = [[point.x - 24, point.y - 24], [point.x + 24, point.y + 24]];
        const features = map.queryRenderedFeatures(extent, { layers: ["closure-road-targets"] });
        const ids = new Set(features.map((feature) => String(feature.properties?.id)));
        const candidates = [...ids].map((id) => roadsRef.current.get(id)).filter((road): road is Road => !!road);
        result = nearestRoad(candidates, point, (coordinate) => map.project(coordinate));
      }
      if (hoverRef.current?.road.properties.id !== result?.road.properties.id) setData(map, "closure-active", closureFeatures(result ? [result.road] : []));
      hoverRef.current = result;
      setGhost({ x: result ? rect.left + result.point.x : client.x, y: result ? rect.top + result.point.y : client.y, snapped: !!result, name: result?.road.properties.name ?? (map.getZoom() < 12 ? "Zoom in to choose a street" : "Move onto a downtown street"), dragging: !!dragRef.current?.moved, keyboard: keyboardRef.current });
      return result;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (lastPointerRef.current) snap(lastPointerRef.current);
      });
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId !== event.pointerId) return;
      if (drag && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 6) drag.moved = true;
      if (!armedRef.current && !drag?.moved) return;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        const result = snap({ x: event.clientX, y: event.clientY });
        cancel();
        if (result) {
          setDraft(result.road);
          setNotice("");
        } else {
          setNotice("No road selected. Drag onto a highlighted downtown street, or click the tool and then a street.");
        }
      } else {
        dragRef.current = null;
        armedRef.current = true;
        setArmed(true);
        canvas.style.cursor = "crosshair";
      }
    };
    const down = (event: PointerEvent) => { clickStart = { x: event.clientX, y: event.clientY }; };
    const click = (event: MouseEvent) => {
      if (clickStart && Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 6) return;
      if (!armedRef.current) {
        const rect = canvas.getBoundingClientRect();
        const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
        const features = map.queryRenderedFeatures(point, { layers: ["closure-applied-line"] });
        const id = features[0]?.properties?.id;
        setDraft(closuresRef.current.find((road) => road.properties.id === id) ?? null);
        return;
      }
      const result = snap({ x: event.clientX, y: event.clientY });
      if (result) {
        cancel();
        setDraft(result.road);
        setNotice("");
      } else setNotice("Choose a highlighted downtown street. Zoom in to separate nearby roads.");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter" && armedRef.current && event.target === canvas && lastPointerRef.current) {
        event.preventDefault();
        const result = snap(lastPointerRef.current);
        if (result) {
          cancel();
          setDraft(result.road);
          setNotice("");
        } else setNotice("Move the map to a downtown street, or use Show area in the toolbox.");
      }
      if (event.key === "Escape") {
        cancel();
        setDraft(null);
        setNotice("");
      }
    };
    const interrupted = (event: PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) cancel();
    };
    const movedMap = () => {
      if (keyboardRef.current) {
        const rect = canvas.getBoundingClientRect();
        lastPointerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      if (armedRef.current || dragRef.current?.moved) schedule();
    };
    cancelRef.current = cancel;
    keyboardPlacementRef.current = () => {
      cancel();
      setDraft(null);
      setNotice("");
      armedRef.current = true;
      keyboardRef.current = true;
      setArmed(true);
      canvas.style.cursor = "crosshair";
      canvas.focus({ preventScroll: true });
      map.setPaintProperty("closure-road-guides", "line-opacity", 0.35);
      const rect = canvas.getBoundingClientRect();
      lastPointerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      snap(lastPointerRef.current);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("click", click);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", interrupted);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    map.on("move", movedMap);
    return () => {
      cancelAnimationFrame(frame);
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("click", click);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", interrupted);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      map.off("move", movedMap);
    };
  }, [map]);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || loadState !== "ready") return;
    event.preventDefault();
    cancelRef.current();
    setDraft(null);
    setNotice("");
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false };
    map.setPaintProperty("closure-road-guides", "line-opacity", 0.35);
  }

  function toggleToolbox() {
    cancelRef.current();
    setDraft(null);
    setNotice("");
    setOpen((value) => !value);
  }

  const existing = !!draft && closures.some((road) => road.properties.id === draft.properties.id);

  return (
    <>
      <div className="closure-toolbox" data-map-ui>
        <ToolboxGlassSurface variant="button">
        <button className="toolbox-toggle" type="button" aria-label="Closure toolbox" aria-expanded={open} aria-controls="closure-toolbox-panel" title="Closure toolbox" onClick={toggleToolbox}>
          <Icon kind="toolbox" />
          {closures.length ? <span className="toolbox-count">{closures.length}</span> : null}
        </button>
        </ToolboxGlassSurface>
        {open ? (
          <ToolboxGlassSurface variant="panel">
          <section className="toolbox-panel" id="closure-toolbox-panel" aria-label="Closure toolbox">
            <div className="toolbox-heading"><div><span className="toolbox-eyebrow">PLAN ON THE MAP</span><h2>Toolbox</h2></div><button className="toolbox-close" type="button" aria-label="Close toolbox" onClick={toggleToolbox}><Icon kind="close" /></button></div>
            <button ref={placementButtonRef} className="closure-drag-tool" type="button" disabled={loadState !== "ready"} aria-pressed={armed} aria-describedby="closure-tool-help" onPointerDown={startDrag} onClick={(event) => {
              if (event.detail !== 0) return;
              keyboardPlacementRef.current();
            }}>
              <span className="closure-tool-icon"><Icon kind="barrier" /></span><span><strong>Road closure</strong><small>{loadState === "loading" ? "Loading selectable roads…" : "Drag onto a street"}</small></span><span className="closure-grip" aria-hidden="true">⠿</span>
            </button>
            <p id="closure-tool-help" className="toolbox-help">Snaps to whole road segments. You can also click the tool, then click a street.</p>
            {loadState === "error" ? <p className="toolbox-load-error" role="alert">Roads could not load. <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></p> : null}
            <div className="toolbox-coverage"><span>Downtown coverage</span><button type="button" onClick={() => map.fitBounds([[-79.435, 43.63], [-79.345, 43.685]], { padding: { top: 100, bottom: 80, left: Math.min(340, map.getCanvas().clientWidth / 3), right: 60 }, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700 })}>Show area <span aria-hidden="true">↗</span></button></div>
            {closures.length ? <div className="closure-list"><span className="toolbox-eyebrow">PLACED CLOSURES · {closures.length}</span>{closures.map((road) => <button type="button" key={road.properties.id} aria-label={`Edit closure on ${road.properties.name}, segment ${road.properties.id}`} onClick={() => { cancelRef.current(); setDraft(road); }}><span className="closure-list-dot" /><span>{road.properties.name}<small>Segment {road.properties.id}</small></span><Icon kind="arrow" /></button>)}</div> : null}
          </section>
          </ToolboxGlassSurface>
        ) : null}
      </div>
      {draft ? (
        <section ref={previewRef} className="closure-preview" aria-labelledby="closure-preview-title" tabIndex={-1} data-map-ui>
          <div className="closure-preview-heading"><span className="closure-tool-icon"><Icon kind="barrier" /></span><div><span className="toolbox-eyebrow">{existing ? "PLACED CLOSURE" : "CLOSURE PREVIEW"}</span><h2 id="closure-preview-title">{draft.properties.name}</h2></div><button className="toolbox-close" type="button" aria-label="Dismiss closure preview" onClick={() => setDraft(null)}><Icon kind="close" /></button></div>
          <p>Full road segment · {draft.properties.lengthM.toLocaleString()} m</p><p className="closure-direction">{draft.properties.direction}</p>
          <div className="closure-preview-actions">{existing ? <><button className="closure-remove" type="button" onClick={() => { setClosures((roads) => roads.filter((road) => road.properties.id !== draft.properties.id)); setDraft(null); setNotice("Closure removed."); }}>Remove closure</button><button className="closure-apply" type="button" onClick={() => setDraft(null)}>Done</button></> : <><button type="button" onClick={() => { setDraft(null); placementButtonRef.current?.focus(); }}>Cancel</button><button className="closure-apply" type="button" onClick={() => { setClosures((roads) => roads.some((road) => road.properties.id === draft.properties.id) ? roads : [...roads, draft]); setDraft(null); setNotice(`Closure placed on ${draft.properties.name}.`); }}>Apply closure</button></>}</div>
        </section>
      ) : null}
      {armed || ghost ? <div className="closure-placement-help" data-map-ui><span className="closure-status-dot" /><span>{ghost?.keyboard ? "Arrow keys move the map · Enter previews a road" : ghost?.snapped ? `${ghost.dragging ? "Release" : "Click"} to preview ${ghost.name}` : "Choose a highlighted downtown street"}</span><button type="button" onClick={() => cancelRef.current()}>Cancel <kbd>Esc</kbd></button></div> : null}
      {ghost ? <div className={`closure-ghost${ghost.snapped ? " is-snapped" : ""}`} style={{ left: ghost.x, top: ghost.y }} aria-hidden="true"><span><Icon kind="barrier" /></span><small>{ghost.name}</small></div> : null}
      <p className={notice ? "closure-notice" : "closure-announcement"} role="status" aria-live="polite">{notice}</p>
    </>
  );
}
