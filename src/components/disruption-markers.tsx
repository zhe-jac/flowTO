"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PointerEvent } from "react";
import type { Disruption } from "@/lib/disruptions";
import { disruptionTool } from "@/lib/disruptions";
import type { DisruptionMap } from "@/lib/disruption-map";
import DisruptionIcon from "./disruption-icon";
import { modelViewVisible } from "@/lib/disruption-model-placement";

export default function DisruptionMarkers({ map, items, draft, placing, modelsReady, onDrag, onSelect }: {
  map: DisruptionMap;
  items: Disruption[];
  draft: Disruption | null;
  placing: boolean;
  modelsReady: boolean;
  onDrag: (event: PointerEvent<HTMLButtonElement>, item: Disruption) => void;
  onSelect: (item: Disruption) => void;
}) {
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const positionsRef = useRef<Disruption[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => [...items.filter((item) => item.id !== draft?.id), ...(draft ? [draft] : [])], [items, draft]);

  useEffect(() => {
    const update = () => {
      const detailed = modelsReady && modelViewVisible(map.getZoom(), map.getPitch());
      if (containerRef.current) containerRef.current.dataset.models = String(detailed);
      for (const item of positionsRef.current) {
        const node = nodesRef.current.get(item.id);
        if (!node) continue;
        const point = map.project(item.position);
        const finite = Number.isFinite(point.x) && Number.isFinite(point.y);
        node.hidden = !finite;
        node.style.visibility = finite ? "visible" : "hidden";
        if (finite) node.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, calc(-100% - ${detailed ? 34 : 6}px))`;
      }
    };
    map.on("move", update);
    map.on("resize", update);
    update();
    return () => { map.off("move", update); map.off("resize", update); };
  }, [map, modelsReady]);

  useEffect(() => {
    positionsRef.current = visible;
    for (const item of visible) {
      const node = nodesRef.current.get(item.id);
      const point = map.project(item.position);
      if (node) {
        node.hidden = !Number.isFinite(point.x) || !Number.isFinite(point.y);
        node.style.visibility = node.hidden ? "hidden" : "visible";
        const detailed = modelsReady && modelViewVisible(map.getZoom(), map.getPitch());
        node.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, calc(-100% - ${detailed ? 34 : 6}px))`;
      }
    }
  }, [map, visible, modelsReady]);

  return (
    <div ref={containerRef} className={`disruption-markers${placing ? " is-placing" : ""}`}>
      {visible.map((item) => item.id === draft?.id ? (
        <span key={item.id} ref={(node) => { if (node) nodesRef.current.set(item.id, node); else nodesRef.current.delete(item.id); }} className="disruption-marker is-preview" data-kind={item.kind} aria-hidden="true"><DisruptionIcon kind={item.kind} /></span>
      ) : (
        <button key={item.id} ref={(node) => { if (node) nodesRef.current.set(item.id, node); else nodesRef.current.delete(item.id); }} type="button" className="disruption-marker" data-kind={item.kind} data-map-ui aria-label={`Edit ${disruptionTool(item.kind).label}: ${item.title}`} title={`${item.title} · Drag to move`} onPointerDown={(event) => onDrag(event, item)} onClick={(event) => { if (event.detail === 0) onSelect(item); }}><DisruptionIcon kind={item.kind} /></button>
      ))}
    </div>
  );
}
