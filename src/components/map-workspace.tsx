"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import { initialTrafficClock } from "@/lib/traffic/clock";
import { simulatorTheme } from "@/lib/simulator-theme";
import { createMapLighting } from "@/lib/map-lighting";
import DisruptionToolbox from "./disruption-toolbox";

const TrafficOverlay = dynamic(() => import("./traffic/traffic-overlay"), { ssr: false });

export default function MapWorkspace({ map, renderer }: { map: MapboxMap | MapLibreMap; renderer: "mapbox" | "maplibre" }) {
  const [items, setItems] = useState<Disruption[]>([]);
  const [interacting, setInteracting] = useState(false);
  const [theme, setTheme] = useState(() => simulatorTheme(initialTrafficClock(window.location.search).minutes));
  const lighting = useMemo(() => createMapLighting(map, renderer), [map, renderer]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.simTheme;
    return () => {
      if (previous) root.dataset.simTheme = previous;
      else delete root.dataset.simTheme;
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.simTheme = theme;
    document.dispatchEvent(new Event("simulator-theme-change"));
    lighting(theme);
  }, [lighting, theme]);

  return (
    <>
      <DisruptionToolbox map={map} onItemsChange={setItems} onInteractionChange={setInteracting} />
      <TrafficOverlay map={map} renderer={renderer} items={items} interacting={interacting} onThemeChange={setTheme} />
    </>
  );
}
