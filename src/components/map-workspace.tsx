"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import DisruptionToolbox from "./disruption-toolbox";

const TrafficOverlay = dynamic(() => import("./traffic/traffic-overlay"), { ssr: false });

export default function MapWorkspace({ map, renderer }: { map: MapboxMap | MapLibreMap; renderer: "mapbox" | "maplibre" }) {
  const [items, setItems] = useState<Disruption[]>([]);
  const [interacting, setInteracting] = useState(false);

  return (
    <>
      <DisruptionToolbox map={map} onItemsChange={setItems} onInteractionChange={setInteracting} />
      <TrafficOverlay map={map} renderer={renderer} items={items} interacting={interacting} />
    </>
  );
}
