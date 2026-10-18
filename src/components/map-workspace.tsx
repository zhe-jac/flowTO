"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import { weatherRatesFromIntensity } from "@/lib/weather";
import { initialTrafficClock } from "@/lib/traffic/clock";
import { dateAtNoon } from "@/lib/traffic/simulation-date";
import { simulatorLight, type SimulatorLight } from "@/lib/daylight";
import { createMapLighting } from "@/lib/map-lighting";
import DisruptionToolbox from "./disruption-toolbox";
import TrafficChat from "./traffic-chat";
import LocationPreview, { type LocationPreviewData } from "./location-preview";
import WorkspaceLayout, { useWorkspaceLayout } from "./workspace-layout";
import type { ChatTrafficContext } from "@/lib/traffic/chat";
import WeatherMenu from "./weather-menu";
import WeatherPrecipitation from "./weather-precipitation";
import { useCurrentWeather } from "./use-current-weather";
import { installBuildingFade, type BuildingFadeController } from "@/lib/building-fade-layer";

const TrafficOverlay = dynamic(() => import("./traffic/traffic-overlay"), { ssr: false });

export default function MapWorkspace({ map, renderer }: { map: MapboxMap | MapLibreMap; renderer: "mapbox" | "maplibre" }) {
  const [chatContext, setChatContext] = useState<ChatTrafficContext | null>(null);
  const [presentTime, setPresentTime] = useState(() => initialTrafficClock(window.location.search).rate.id === "live");
  const conditions = useCurrentWeather(presentTime);
  const trafficWeather = useMemo(() => conditions.mode === "current" && conditions.reading ? { rainMmPerHour: conditions.reading.rainMmPerHour, snowCmPerHour: conditions.reading.snowCmPerHour } : weatherRatesFromIntensity(conditions.weather), [conditions.mode, conditions.reading, conditions.weather]);
  const [locationPreview, setLocationPreview] = useState<LocationPreviewData | null>(null);
  const [items, setItems] = useState<Disruption[]>([]);
  const [interacting, setInteracting] = useState(false);
  const [buildingFade, setBuildingFade] = useState<BuildingFadeController | null>(null);
  const [light, setLight] = useState<SimulatorLight>(() => { const clock = initialTrafficClock(window.location.search); return simulatorLight(clock.minutes, dateAtNoon(clock.date)); });
  const theme = light.theme;
  const lighting = useMemo(() => createMapLighting(map, renderer), [map, renderer]);

  useEffect(() => {
    const controller = installBuildingFade(map, renderer);
    setBuildingFade(controller);
    return () => controller.dispose();
  }, [map, renderer]);

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
      <WeatherPrecipitation map={map} weather={conditions.weather} night={theme === "night"} smooth={conditions.mode === "current"} />
      <LocationPreview map={map} data={locationPreview} />
      <WorkspaceLayout>
        <WorkspaceMenus map={map} items={items} setItems={setItems} onInteractionChange={setInteracting} conditions={conditions} presentTime={presentTime} />
        <TrafficChat onPreview={setLocationPreview} getMapReference={() => { const p = map.getCenter(); return [p.lng, p.lat]; }} context={chatContext} items={items} weather={trafficWeather} onApply={proposals => { if (items.length + proposals.length > 20) return false; setItems(current => [...current, ...proposals]); return true; }} />
        <TrafficOverlay weather={trafficWeather} map={map} renderer={renderer} items={items} interacting={interacting} onLightChange={setLight} onPresentTimeChange={setPresentTime} buildingFade={buildingFade} onChatContext={setChatContext} />
      </WorkspaceLayout>
    </>
  );
}

function WorkspaceMenus({ map, items, setItems, onInteractionChange, conditions, presentTime }: {
  map: MapboxMap | MapLibreMap;
  items: Disruption[];
  setItems: import("react").Dispatch<import("react").SetStateAction<Disruption[]>>;
  onInteractionChange: (active: boolean) => void;
  conditions: ReturnType<typeof useCurrentWeather>;
  presentTime: boolean;
}) {
  const { panel, setPanel } = useWorkspaceLayout();
  const openToolbox = useCallback((open: boolean) => setPanel(open ? "toolbox" : null), [setPanel]);
  const openWeather = useCallback((open: boolean) => setPanel(open ? "weather" : null), [setPanel]);
  return <>
    <DisruptionToolbox map={map} items={items} setItems={setItems} onInteractionChange={onInteractionChange} open={panel === "toolbox"} onOpenChange={openToolbox} suspended={panel !== "toolbox" && panel !== "editor"} />
    <WeatherMenu open={panel === "weather"} onOpenChange={openWeather} weather={conditions.weather} onChange={conditions.manualWeather} mode={conditions.mode} reading={conditions.reading} status={conditions.status} presentTime={presentTime} onModeChange={conditions.chooseMode} onRefresh={conditions.refresh} />
  </>;
}
