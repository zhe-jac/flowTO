"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { FeatureCollection } from "geojson";
import { isPointInToronto } from "@/lib/city-boundary";
import type { Coordinate } from "@/lib/city-boundary";
import { nearestRoad } from "@/lib/closure-placement";
import type { ScreenPoint } from "@/lib/closure-placement";
import { createDisruption, DISRUPTION_TOOLS, disruptionFeatures, disruptionTool, upsertDisruption, validateDisruption } from "@/lib/disruptions";
import type { Disruption, DisruptionKind } from "@/lib/disruptions";
import { setDisruptionData } from "@/lib/disruption-map";
import type { DisruptionMap } from "@/lib/disruption-map";
import type { Road, RoadCollection } from "@/lib/types";
import DisruptionEditor from "./disruption-editor";
import DisruptionIcon from "./disruption-icon";
import DisruptionMarkers from "./disruption-markers";
import DisruptionScenes from "./disruption-scenes";
import DisruptionEndpoints from "./disruption-endpoints";
import { extentDetails } from "@/lib/road-extent";
import { setBuildingFadeFocus } from "@/lib/building-fade";
import { motion, type Transition, type Variants } from "motion/react";

type Placement = { kind: DisruptionKind; position: Coordinate; point: ScreenPoint; road?: Road };
type Drag = { pointerId: number; start: ScreenPoint; moved: boolean; kind: DisruptionKind; item?: Disruption };
type Ghost = ScreenPoint & { valid: boolean; name: string; kind: DisruptionKind; dragging: boolean; keyboard: boolean };
const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["disruption-roads", "disruption-active", "disruption-applied"];
const LAYERS = ["disruption-road-guides", "disruption-road-targets", ...["applied", "active"].flatMap((kind) => ["halo", "line", "stripes", "ends", "locations"].map((layer) => `disruption-${kind}-${layer}`))];

/** The toolbox button morphs into the panel: one element whose size and corners spring between the two. */
const MORPH_SPRING: Transition = { type: "spring", stiffness: 260, damping: 25 };
/** Panel content fades in with a stagger once the panel has started expanding, and fades out before it shrinks. */
const BUTTON_SIZE = 48;
const PANEL_WIDTH = 282;
const MORPH_PANEL: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: 0.12, delayChildren: 0.1, staggerChildren: 0.04 } },
  exit: { opacity: 0, transition: { duration: 0.12, when: "afterChildren" } },
};
const MORPH_ITEM: Variants = {
  hidden: { opacity: 0, y: 6 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.22, 1, 0.36, 1] } },
  exit: { opacity: 0, y: 4, transition: { duration: 0.1 } },
};

export default function DisruptionToolbox({ map, onItemsChange, onInteractionChange }: { map: DisruptionMap; onItemsChange: (items: Disruption[]) => void; onInteractionChange: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // The panel stays mounted (hidden when closed) so its height is known and the container can spring to it.
  const panelRef = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const observer = new ResizeObserver(() => setPanelHeight(Math.round(panel.getBoundingClientRect().height)));
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);
  const morphedRef = useRef(false);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const [activeTool, setActiveTool] = useState<DisruptionKind | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [draft, setDraft] = useState<Disruption | null>(null);
  const [items, setItems] = useState<Disruption[]>([]);
  const [modelsReady, setModelsReady] = useState(false);
  const sceneItems = useMemo(() => [...items.filter((item) => item.id !== draft?.id), ...(draft ? [draft] : [])], [items, draft]);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const roadsRef = useRef(new Map<string, Road>());
  const itemsRef = useRef<Disruption[]>([]);
  const dragRef = useRef<Drag | null>(null);
  const armedRef = useRef<DisruptionKind | null>(null);
  const keyboardRef = useRef(false);
  const hoverRef = useRef<Placement | null>(null);
  const lastPointerRef = useRef<ScreenPoint | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  const activateRef = useRef<(kind: DisruptionKind) => void>(() => {});
  const toolButtonsRef = useRef(new Map<DisruptionKind, HTMLButtonElement>());
  const interacting = !!activeTool || !!ghost || !!draft;

  useEffect(() => { onItemsChange(items); }, [items, onItemsChange]);
  useEffect(() => { onInteractionChange(interacting); }, [interacting, onInteractionChange]);

  useEffect(() => {
    const container = map.getCanvas().parentElement;
    if (container) container.dataset.disruptionInteraction = String(interacting);
    return () => { if (container) delete container.dataset.disruptionInteraction; };
  }, [map, interacting]);

  useEffect(() => {
    map.addSource("disruption-roads", { type: "geojson", data: EMPTY, attribution: '<a href="https://open.toronto.ca/dataset/toronto-centreline-tcl/" target="_blank" rel="noopener noreferrer">Roads: City of Toronto</a>' });
    map.addLayer({ id: "disruption-road-guides", type: "line", source: "disruption-roads", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#397caa", "line-width": 2, "line-opacity": 0 } });
    map.addLayer({ id: "disruption-road-targets", type: "line", source: "disruption-roads", paint: { "line-width": 24, "line-opacity": 0 } });
    for (const kind of ["applied", "active"]) {
      const source = `disruption-${kind}`;
      map.addSource(source, { type: "geojson", data: EMPTY });
      map.addLayer({ id: `${source}-halo`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#fffaf7", "line-width": 12, "line-opacity": 0.95 } });
      map.addLayer({ id: `${source}-line`, type: "line", source, filter: ["==", ["geometry-type"], "LineString"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": ["case", ["==", ["get", "restriction"], "full-closure"], 7, 5] } });
      map.addLayer({ id: `${source}-stripes`, type: "line", source, filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "restriction"], "full-closure"]], layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": "#fffaf7", "line-width": 2, "line-dasharray": [2, 2] } });
      map.addLayer({ id: `${source}-ends`, type: "circle", source, filter: ["==", ["get", "role"], "endpoint"], paint: { "circle-radius": 4, "circle-color": "#fffaf7", "circle-stroke-color": ["get", "color"], "circle-stroke-width": 2 } });
      map.addLayer({ id: `${source}-locations`, type: "circle", source, filter: ["==", ["get", "role"], "location"], paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-stroke-color": "#fffaf7", "circle-stroke-width": 2 } });
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
      setDisruptionData(map, "disruption-roads", data);
      setLoadState("ready");
    }).catch(() => { if (!controller.signal.aborted) setLoadState("error"); });
    return () => controller.abort();
  }, [map, open, retry]);

  useEffect(() => {
    itemsRef.current = items;
    setDisruptionData(map, "disruption-applied", disruptionFeatures(items.filter(item => item.id !== draft?.id), roadsRef.current));
  }, [map, items, draft?.id]);

  useEffect(() => {
    setDisruptionData(map, "disruption-active", disruptionFeatures(draft ? [draft] : [], roadsRef.current));
  }, [map, draft]);

  useEffect(() => {
    const canvas = map.getCanvas();
    let frame = 0;
    let clickStart: ScreenPoint | null = null;
    const cancel = () => {
      cancelAnimationFrame(frame);
      setBuildingFadeFocus(canvas, null);
      dragRef.current = null;
      armedRef.current = null;
      keyboardRef.current = false;
      hoverRef.current = null;
      lastPointerRef.current = null;
      setActiveTool(null);
      setGhost(null);
      canvas.style.cursor = "";
      map.setPaintProperty("disruption-road-guides", "line-opacity", 0);
      setDisruptionData(map, "disruption-active", EMPTY);
    };
    const resolve = (client: ScreenPoint, kind: DisruptionKind): Placement | null => {
      const rect = canvas.getBoundingClientRect();
      const point = { x: client.x - rect.left, y: client.y - rect.top };
      const overControls = document.elementFromPoint(client.x, client.y)?.closest("[data-map-ui], .mapboxgl-ctrl, .maplibregl-ctrl");
      setBuildingFadeFocus(canvas, !overControls && point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height ? point : null);
      let result: Placement | null = null;
      if (!overControls && point.x >= 0 && point.y >= 0 && point.x <= rect.width && point.y <= rect.height) {
        if (kind === "event") {
          const location = map.unproject([point.x, point.y]);
          const position: Coordinate = [location.lng, location.lat];
          if (isPointInToronto(position)) result = { kind, point, position };
        } else if (map.getZoom() >= 12) {
          const extent: [[number, number], [number, number]] = [[point.x - 24, point.y - 24], [point.x + 24, point.y + 24]];
          const ids = new Set(map.queryRenderedFeatures(extent, { layers: ["disruption-road-targets"] }).map((feature) => String(feature.properties?.id)));
          const candidates = [...ids].map((id) => roadsRef.current.get(id)).filter((road): road is Road => !!road);
          const snap = nearestRoad(candidates, point, (coordinate) => map.project(coordinate));
          if (snap) {
            const position = snap.coordinate;
            if (isPointInToronto(position)) result = { kind, point: snap.point, position, road: snap.road };
          }
        }
      }
      if (hoverRef.current?.kind !== result?.kind || hoverRef.current?.road?.properties.id !== result?.road?.properties.id) {
        const preview = result?.road ? createDisruption("hover", kind, result.position, result.road) : null;
        const data = disruptionFeatures(preview ? [preview] : [], roadsRef.current);
        data.features = data.features.filter((feature) => feature.properties?.role !== "location");
        setDisruptionData(map, "disruption-active", data);
      }
      hoverRef.current = result;
      setGhost({
        x: result ? rect.left + result.point.x : client.x,
        y: result ? rect.top + result.point.y : client.y,
        valid: !!result,
        kind,
        name: result ? result.road?.properties.name ?? "Event location" : kind === "event" ? "Choose a location inside Toronto" : map.getZoom() < 12 ? "Zoom in to choose a street" : "Move onto a downtown street",
        dragging: !!dragRef.current?.moved,
        keyboard: keyboardRef.current,
      });
      return result;
    };
    const preview = (placement: Placement, original?: Disruption) => {
      const duplicate = placement.kind === "closure" ? itemsRef.current.find((item) => item.kind === "closure" && item.roadId === placement.road?.properties.id) : undefined;
      const item = original ?? duplicate ?? createDisruption(crypto.randomUUID(), placement.kind, placement.position, placement.road);
      if (!item) return;
      setDraft(duplicate && !original ? { ...duplicate } : item.kind === "event" ? { ...item, position: placement.position } : { ...item, position: placement.position, roadId: placement.road!.properties.id, roadSections: undefined });
      setFormError("");
      setNotice("");
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const kind = dragRef.current?.kind ?? armedRef.current;
        if (kind && lastPointerRef.current) resolve(lastPointerRef.current, kind);
      });
    };
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (drag && drag.pointerId !== event.pointerId) return;
      if (drag && Math.hypot(event.clientX - drag.start.x, event.clientY - drag.start.y) > 6) drag.moved = true;
      if (!armedRef.current && !drag?.moved) return;
      keyboardRef.current = false;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const finish = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        const result = resolve({ x: event.clientX, y: event.clientY }, drag.kind);
        cancel();
        if (result) preview(result, drag.item);
        else setNotice(drag.kind === "event" ? drag.item ? "Choose an event location inside Toronto. The previous location was kept." : "Drop the event at a location inside Toronto." : "No street selected. Drop onto a highlighted downtown street.");
      } else if (drag.item) {
        cancel();
        setDraft({ ...drag.item });
        setFormError("");
        setNotice("");
      } else {
        dragRef.current = null;
        armedRef.current = drag.kind;
        setActiveTool(drag.kind);
        canvas.style.cursor = "crosshair";
      }
    };
    const down = (event: PointerEvent) => { clickStart = { x: event.clientX, y: event.clientY }; };
    const click = (event: MouseEvent) => {
      if (clickStart && Math.hypot(event.clientX - clickStart.x, event.clientY - clickStart.y) > 6) return;
      const kind = armedRef.current;
      if (!kind) {
        const rect = canvas.getBoundingClientRect();
        const point: [number, number] = [event.clientX - rect.left, event.clientY - rect.top];
        const features = map.queryRenderedFeatures([[point[0] - 5, point[1] - 5], [point[0] + 5, point[1] + 5]], { layers: ["disruption-applied-line"] });
        const item = itemsRef.current.find((current) => current.id === features[0]?.properties?.itemId);
        setDraft(item ? { ...item } : null);
        setFormError("");
        return;
      }
      const result = resolve({ x: event.clientX, y: event.clientY }, kind);
      if (result) { cancel(); preview(result); }
      else setNotice(kind === "event" ? "Choose a location inside Toronto." : "Choose a highlighted downtown street. Zoom in to separate nearby roads.");
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Enter" && armedRef.current && event.target === canvas && lastPointerRef.current) {
        event.preventDefault();
        const result = resolve(lastPointerRef.current, armedRef.current);
        if (result) { cancel(); preview(result); }
        else setNotice("Move the map to a valid location, then press Enter.");
      }
      if (event.key === "Escape") { cancel(); setDraft(null); setFormError(""); setNotice(""); }
    };
    const interrupted = (event: PointerEvent) => { if (dragRef.current?.pointerId === event.pointerId) cancel(); };
    const blurred = () => { if (armedRef.current || dragRef.current) cancel(); };
    const movedMap = () => {
      if (keyboardRef.current) {
        const rect = canvas.getBoundingClientRect();
        lastPointerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
      if (armedRef.current || dragRef.current?.moved) schedule();
    };
    cancelRef.current = cancel;
    activateRef.current = (kind) => {
      cancel();
      setDraft(null);
      setFormError("");
      setNotice("");
      armedRef.current = kind;
      keyboardRef.current = true;
      setActiveTool(kind);
      canvas.style.cursor = "crosshair";
      canvas.focus({ preventScroll: true });
      map.setPaintProperty("disruption-road-guides", "line-opacity", kind === "event" ? 0 : 0.35);
      const rect = canvas.getBoundingClientRect();
      lastPointerRef.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      resolve(lastPointerRef.current, kind);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("click", click);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", interrupted);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", blurred);
    map.on("move", movedMap);
    return () => {
      cancelAnimationFrame(frame);
      setBuildingFadeFocus(canvas, null);
      canvas.style.cursor = "";
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("click", click);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", interrupted);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", blurred);
      map.off("move", movedMap);
    };
  }, [map]);

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, kind: DisruptionKind, item?: Disruption) {
    if (event.button !== 0 || (kind !== "event" && !roadsRef.current.size)) return;
    event.preventDefault();
    cancelRef.current();
    setDraft(null);
    setFormError("");
    setNotice("");
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false, kind, item };
    setActiveTool(kind);
    map.setPaintProperty("disruption-road-guides", "line-opacity", kind === "event" ? 0 : 0.35);
  }

  function selectItem(item: Disruption) {
    cancelRef.current();
    setDraft({ ...item });
    setFormError("");
    setNotice("");
  }

  // The button and panel are one morphing element, so focus moves to whichever is showing.
  useEffect(() => {
    if (!morphedRef.current) { morphedRef.current = true; return; }
    const frame = requestAnimationFrame(() => {
      if (open) document.querySelector<HTMLButtonElement>("#disruption-toolbox-panel .toolbox-close")?.focus();
      else toggleRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  function toggleToolbox() {
    cancelRef.current();
    setDraft(null);
    setFormError("");
    setNotice("");
    setOpen((value) => !value);
  }

  function saveDraft() {
    if (!draft) return;
    const error = validateDisruption(draft);
    if (error) { setFormError(error); return; }
    setItems((current) => upsertDisruption(current, draft));
    setDraft(null);
    setNotice(`${disruptionTool(draft.kind).label} saved.`);
    toolButtonsRef.current.get(draft.kind)?.focus();
  }

  function resetScenario() {
    cancelRef.current();
    itemsRef.current = [];
    setItems([]);
    setDraft(null);
    setFormError("");
    setNotice("All disruptions removed. Baseline traffic restored.");
  }

  const existing = !!draft && items.some((item) => item.id === draft.id);

  return (
    <>
      <DisruptionScenes map={map} items={sceneItems} roads={roadsRef.current} onReady={setModelsReady} />
      <DisruptionMarkers map={map} items={items} draft={draft} modelsReady={modelsReady} placing={!!activeTool || !!ghost} onDrag={(event, item) => startDrag(event, item.kind, item)} onSelect={selectItem} />
      {draft && draft.kind !== "event" ? <DisruptionEndpoints map={map} draft={draft} roads={roadsRef.current} onChange={item => { setDraft(item); setFormError(""); }} /> : null}
      <div className="closure-toolbox" data-map-ui>
        <motion.div className="toolbox-morph" data-open={open} initial={false}
          animate={{ width: open ? PANEL_WIDTH : BUTTON_SIZE, height: open ? panelHeight || BUTTON_SIZE : BUTTON_SIZE, borderRadius: open ? 24 : 17 }}
          transition={open ? MORPH_SPRING : { ...MORPH_SPRING, delay: 0.1 }}>
              <motion.section ref={panelRef} className="toolbox-panel" id="disruption-toolbox-panel" aria-label="Disruption toolbox" aria-hidden={!open} inert={!open} variants={MORPH_PANEL} initial={false} animate={open ? "shown" : "exit"}>
                <motion.div variants={MORPH_ITEM} className="toolbox-heading"><div><span className="toolbox-eyebrow">PLAN ON THE MAP</span><h2>Toolbox</h2></div><button className="toolbox-close" type="button" aria-label="Close toolbox" onClick={toggleToolbox}><DisruptionIcon kind="close" /></button></motion.div>
                <motion.div variants={MORPH_ITEM} className="disruption-tool-grid">{DISRUPTION_TOOLS.map((tool) => <button key={tool.kind} ref={(node) => { if (node) toolButtonsRef.current.set(tool.kind, node); else toolButtonsRef.current.delete(tool.kind); }} className="closure-drag-tool" type="button" data-kind={tool.kind} disabled={tool.kind !== "event" && loadState !== "ready"} aria-pressed={activeTool === tool.kind} aria-describedby="disruption-tool-help" onPointerDown={(event) => startDrag(event, tool.kind)} onClick={(event) => { if (event.detail === 0) activateRef.current(tool.kind); }}><span className="closure-tool-icon"><DisruptionIcon kind={tool.kind} /></span><strong>{tool.label}</strong><small>{tool.hint}</small><span className="closure-grip" aria-hidden="true">⠿</span></button>)}</motion.div>
                <motion.p variants={MORPH_ITEM} id="disruption-tool-help" className="toolbox-help">Drag a tool onto the map, or click a tool and then a location. Drag placed markers to move them.</motion.p>
                <motion.button variants={MORPH_ITEM} className="scenario-reset" type="button" disabled={!items.length && !draft && !activeTool && !ghost} onClick={resetScenario} title="Remove all disruptions and restore baseline traffic">Reset</motion.button>
                {loadState === "loading" ? <motion.p variants={MORPH_ITEM} className="toolbox-loading" role="status">Loading streets for road tools…</motion.p> : null}
                {loadState === "error" ? <motion.p variants={MORPH_ITEM} className="toolbox-load-error" role="alert">Street tools could not load. Events are still available. <button type="button" onClick={() => setRetry((value) => value + 1)}>Try again</button></motion.p> : null}
                <motion.div variants={MORPH_ITEM} className="toolbox-coverage"><span>Street tools: downtown</span><button type="button" onClick={() => map.fitBounds([[-79.435, 43.63], [-79.345, 43.685]], { padding: { top: 100, bottom: 80, left: Math.min(340, map.getCanvas().clientWidth / 3), right: 60 }, duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 700 })}>Show area <span aria-hidden="true">↗</span></button></motion.div>
                {items.length ? <motion.div variants={MORPH_ITEM} className="closure-list"><span className="toolbox-eyebrow">PLACED ITEMS · {items.length}</span>{items.map((item) => <button type="button" key={item.id} data-kind={item.kind} onClick={() => selectItem(item)}><span className="disruption-list-icon"><DisruptionIcon kind={item.kind} /></span><span>{item.title}<small>{disruptionTool(item.kind).label}{item.kind === "event" ? item.attendance === null ? " · attendance not set" : ` · ${item.attendance.toLocaleString()} attendees` : ` · ${roadsRef.current.get(item.roadId)?.properties.name ?? "Street segment"}`}</small></span><DisruptionIcon kind="arrow" /></button>)}</motion.div> : null}
              </motion.section>
              <motion.button ref={toggleRef} tabIndex={open ? -1 : 0} aria-hidden={open} className="toolbox-toggle" type="button" aria-label={items.length ? `Disruption toolbox, ${items.length} placed ${items.length === 1 ? "item" : "items"}` : "Disruption toolbox"} aria-expanded={open} aria-controls="disruption-toolbox-panel" title="Disruption toolbox" onClick={toggleToolbox} initial={false} animate={open ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 1, transition: { duration: 0.2, delay: 0.22 } }} style={{ pointerEvents: open ? "none" : "auto" }}><DisruptionIcon kind="toolbox" /></motion.button>
        </motion.div>
        {items.length ? <motion.span className="toolbox-count" aria-hidden="true" initial={false} animate={open ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 1, transition: { duration: 0.2, delay: 0.22 } }}>{items.length}</motion.span> : null}
      </div>
      {draft ? <DisruptionEditor draft={draft} road={draft.kind === "event" ? undefined : roadsRef.current.get(draft.roadId)} extent={draft.kind === "event" ? undefined : extentDetails(draft, roadsRef.current)} existing={existing} error={formError} onChange={(item) => { setDraft(item); setFormError(""); }} onSave={saveDraft} onCancel={() => { setDraft(null); setFormError(""); toolButtonsRef.current.get(draft.kind)?.focus(); }} onRemove={() => { setItems((current) => current.filter((item) => item.id !== draft.id)); setDraft(null); setNotice(`${disruptionTool(draft.kind).label} removed.`); toolButtonsRef.current.get(draft.kind)?.focus(); }} /> : null}
      {activeTool || ghost ? <div className="closure-placement-help" data-map-ui data-kind={activeTool ?? ghost?.kind}><span className="closure-status-dot" /><span>{ghost?.keyboard ? "Arrow keys move the map · Enter previews the location" : ghost?.valid ? `${ghost.dragging ? "Release" : "Click"} to preview ${ghost.name}` : activeTool === "event" ? "Choose an event location inside Toronto" : "Choose a highlighted downtown street"}</span><button type="button" onClick={() => cancelRef.current()}>Cancel <kbd>Esc</kbd></button></div> : null}
      {ghost ? <div className={`closure-ghost${ghost.valid ? " is-snapped" : ""}`} data-kind={ghost.kind} style={{ left: ghost.x, top: ghost.y }} aria-hidden="true"><span><DisruptionIcon kind={ghost.kind} /></span><small>{ghost.name}</small></div> : null}
      <p className={notice && !activeTool ? "closure-notice" : "closure-announcement"} role="status" aria-live="polite">{notice}</p>
    </>
  );
}
