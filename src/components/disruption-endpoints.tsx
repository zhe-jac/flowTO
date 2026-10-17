"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { RoadDisruption } from "@/lib/disruptions";
import type { DisruptionMap } from "@/lib/disruption-map";
import type { Road } from "@/lib/types";
import { nearestRoad } from "@/lib/closure-placement";
import { applyRoadSections, extentAnchors, pointOnRoad, roadSections, traceRoadExtent } from "@/lib/road-extent";

type CursorPoint = { x: number; y: number };
type Props = { map: DisruptionMap; draft: RoadDisruption; roads: ReadonlyMap<string, Road>; onChange: (item: RoadDisruption) => void };
type Drag = { pointerId: number; index: number; original: RoadDisruption; valid: boolean; previous: CursorPoint; pending: CursorPoint[]; node: HTMLButtonElement };

export default function DisruptionEndpoints(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const nodes = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<Drag | null>(null);
  const frame = useRef(0);
  const [status, setStatus] = useState("");
  const [dragging, setDragging] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const updatePositions = useRef<() => void>(() => {});

  const change = (item: RoadDisruption) => {
    latest.current = { ...latest.current, draft: item };
    latest.current.onChange(item);
  };

  const resolve = (client: CursorPoint, index: number) => {
    const { map, roads, draft } = latest.current;
    const rect = map.getCanvas().getBoundingClientRect();
    const point = { x: client.x - rect.left, y: client.y - rect.top };
    const over = document.elementFromPoint(client.x, client.y)?.closest("[data-map-ui], .mapboxgl-ctrl, .maplibregl-ctrl");
    if (over && !over.classList.contains("disruption-endpoint")) return false;
    if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height || map.getZoom() < 12) return false;
    const path = roadSections(draft);
    const features = map.queryRenderedFeatures([[point.x - 28, point.y - 28], [point.x + 28, point.y + 28]], { layers: ["disruption-road-targets"] });
    const candidates = [...new Set(features.map(feature => String(feature.properties?.id)))].flatMap(id => roads.has(id) ? [roads.get(id)!] : []);
    const snaps = candidates.flatMap(road => {
      const snap = nearestRoad([road], point, coordinate => map.project(coordinate), 28);
      return snap ? [snap] : [];
    }).sort((a, b) => a.distance - b.distance);
    if (!snaps.length) return false;
    let sections = null;
    for (const snap of snaps) {
      if (snap.distance > snaps[0].distance + 2) break;
      sections = traceRoadExtent(path, { roadId: snap.road.properties.id, fraction: snap.fraction }, index, roads);
      if (sections) break;
    }
    if (!sections) return false;
    if (sections.length !== path.length || sections.some((section, i) => section.roadId !== path[i].roadId || section.from !== path[i].from || section.to !== path[i].to)) change(applyRoadSections(draft, sections, roads));
    return true;
  };
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    const update = () => {
      const { map, draft, roads } = latest.current;
      const anchors = extentAnchors(draft);
      const canvas = map.getCanvas();
      anchors.forEach((anchor, index) => {
        const node = nodes.current[index], road = roads.get(anchor.roadId);
        if (!node || !road) return;
        const point = map.project(pointOnRoad(road, anchor.fraction));
        const visible = Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= -24 && point.y >= -24 && point.x <= canvas.clientWidth + 24 && point.y <= canvas.clientHeight + 24;
        node.style.visibility = visible ? "visible" : "hidden";
        node.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, -50%)`;
      });
    };
    updatePositions.current = update;
    update();
    props.map.on("move", update);
    props.map.on("resize", update);
    return () => { props.map.off("move", update); props.map.off("resize", update); };
  }, [props.map]);

  useEffect(() => { updatePositions.current(); }, [props.draft]);

  useEffect(() => {
    const map = props.map;
    const process = (active: Drag) => {
      for (const point of active.pending.splice(0)) {
        const from = active.previous;
        const steps = Math.min(256, Math.max(1, Math.ceil(Math.hypot(point.x - from.x, point.y - from.y) / 4)));
        for (let step = 1; step <= steps; step++) active.valid = resolveRef.current({ x: from.x + (point.x - from.x) * step / steps, y: from.y + (point.y - from.y) * step / steps }, active.index);
        active.previous = point;
      }
      setInvalid(!active.valid);
    };
    const restore = (revert: boolean) => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      const active = drag.current;
      drag.current = null;
      if (active && revert) {
        latest.current = { ...latest.current, draft: active.original };
        latest.current.onChange(active.original);
      }
      if (active?.node.hasPointerCapture(active.pointerId)) active.node.releasePointerCapture(active.pointerId);
      map.setPaintProperty("disruption-road-guides", "line-opacity", 0);
      setDragging(null);
      setInvalid(false);
    };
    const move = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      const samples = event.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length ? samples : [event]) active.pending.push({ x: sample.clientX, y: sample.clientY });
      if (frame.current) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        if (drag.current !== active) return;
        process(active);
      });
    };
    const finish = (event: PointerEvent) => {
      const active = drag.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.pending.push({ x: event.clientX, y: event.clientY });
      process(active);
      setStatus(active.valid ? "Road extent updated. Save changes to apply it." : "Choose a street connected to the latest intersection, keeping at least 5 m selected. The previous extent was kept.");
      restore(!active.valid);
    };
    const cancel = () => { if (drag.current) { restore(true); setStatus("Endpoint move cancelled. The previous extent was kept."); } };
    const interrupted = (event: PointerEvent) => { if (drag.current?.pointerId === event.pointerId) cancel(); };
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && drag.current) { event.preventDefault(); event.stopImmediatePropagation(); cancel(); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", interrupted);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", interrupted);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key, true);
      if (map.getLayer("disruption-road-guides")) map.setPaintProperty("disruption-road-guides", "line-opacity", 0);
    };
  }, [props.map]);

  const start = (event: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (event.button !== 0 || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, index, original: latest.current.draft, valid: true, previous: { x: event.clientX, y: event.clientY }, pending: [], node: event.currentTarget };
    setDragging(index);
    setInvalid(false);
    setStatus("");
    props.map.setPaintProperty("disruption-road-guides", "line-opacity", 0.3);
  };

  const key = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const offsets: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key];
    if (!offset) return;
    event.preventDefault();
    event.stopPropagation();
    const { map, draft, roads } = latest.current;
    const anchors = extentAnchors(draft), road = roads.get(anchors[index].roadId);
    if (!road) return;
    const point = map.project(pointOnRoad(road, anchors[index].fraction));
    const rect = map.getCanvas().getBoundingClientRect();
    const step = event.shiftKey ? 40 : 12;
    let valid = false;
    for (let distance = 4; distance <= step; distance += 4) valid = resolveRef.current({ x: rect.left + point.x + offset[0] * distance, y: rect.top + point.y + offset[1] * distance }, index);
    setStatus(valid ? "Road extent updated. Save changes to apply it." : "No connected street in that direction. Try another arrow key or zoom in.");
  };

  return (
    <div className="disruption-endpoints" data-kind={props.draft.kind}>
      {["Start", "End"].map((label, index) => <button key={label} ref={node => { nodes.current[index] = node; }} className="disruption-endpoint" type="button" data-map-ui data-dragging={dragging === index} data-invalid={dragging === index && invalid} aria-label={`${label} of affected road. Drag or use arrow keys to adjust.`} aria-describedby="road-extent-help" title={`${label} of affected road · Drag to resize`} onPointerDown={event => start(event, index)} onKeyDown={event => key(event, index)}><span aria-hidden="true" /></button>)}
      <span className="closure-announcement" role="status" aria-live="polite">{status}</span>
    </div>
  );
}
