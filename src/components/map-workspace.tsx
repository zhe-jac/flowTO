"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import { initialTrafficClock } from "@/lib/traffic/clock";
import { simulatorLight, type SimulatorLight } from "@/lib/daylight";
import { createMapLighting } from "@/lib/map-lighting";
import DisruptionToolbox from "./disruption-toolbox";

const TrafficOverlay = dynamic(() => import("./traffic/traffic-overlay"), { ssr: false });

export default function MapWorkspace({ map, renderer }: { map: MapboxMap | MapLibreMap; renderer: "mapbox" | "maplibre" }) {
  const [items, setItems] = useState<Disruption[]>([]);
  const [interacting, setInteracting] = useState(false);
  const [light, setLight] = useState<SimulatorLight>(() => simulatorLight(initialTrafficClock(window.location.search).minutes));
  const theme = light.theme;
  const lighting = useMemo(() => createMapLighting(map, renderer), [map, renderer]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.simTheme;
    return () => {
      if (previous) root.dataset.simTheme = previous;
      else delete root.dataset.simTheme;
      delete root.dataset.simDaylight;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.simTheme = theme;
    root.dataset.simDaylight = String(light.daylight);
    document.dispatchEvent(new Event("simulator-theme-change"));
    lighting(light);
  }, [lighting, light, theme]);

  return (
    <>
      <DisruptionToolbox map={map} onItemsChange={setItems} onInteractionChange={setInteracting} />
      <TrafficOverlay map={map} renderer={renderer} items={items} interacting={interacting} onLightChange={setLight} />
    </>
  );
}
