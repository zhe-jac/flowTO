"use client";

import { useEffect, useRef } from "react";
import type { DisruptionMap } from "@/lib/disruption-map";
import type { Disruption } from "@/lib/disruptions";
import type { Road } from "@/lib/types";
import type { installDisruptionModels } from "@/lib/disruption-model-layer";

export default function DisruptionScenes({ map, items, roads, onReady }: {
  map: DisruptionMap;
  items: Disruption[];
  roads: ReadonlyMap<string, Road>;
  onReady: (ready: boolean) => void;
}) {
  const controllerRef = useRef<ReturnType<typeof installDisruptionModels> | null>(null);
  const latestRef = useRef({ items, roads });
  const hasItems = items.length > 0;

  useEffect(() => {
    latestRef.current = { items, roads };
    controllerRef.current?.update(items, roads);
  }, [items, roads]);

  useEffect(() => {
    if (!hasItems) { onReady(false); return; }
    let cancelled = false;
    void import("@/lib/disruption-model-layer").then(({ installDisruptionModels }) => {
      if (cancelled) return;
      const controller = installDisruptionModels(map, onReady);
      controllerRef.current = controller;
      controller.update(latestRef.current.items, latestRef.current.roads);
    }).catch((error) => {
      if (!cancelled) { onReady(false); console.error("Disruption models could not load:", error); }
    });
    return () => { cancelled = true; controllerRef.current?.dispose(); controllerRef.current = null; };
  }, [map, hasItems, onReady]);

  return null;
}
