"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import { weatherRatesFromIntensity } from "@/lib/weather";
import { initialTrafficClock, type ClockState } from "@/lib/traffic/clock";
import type { DisruptionPlacement } from "@/lib/traffic/scenario-timing";
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
  const [clock, setClock] = useState(() => initialTrafficClock(window.location.search));
  const clockRef = useRef(clock);
  const placedAtRef = useRef(new Map<string, DisruptionPlacement>());
  const [chatContext, setChatContext] = useState<ChatTrafficContext | null>(null);
  const [presentTime, setPresentTime] = useState(() => initialTrafficClock(window.location.search).rate.id === "live");
  const conditions = useCurrentWeather(presentTime);
  const trafficWeather = useMemo(() => conditions.mode === "current" && conditions.reading ? { rainMmPerHour: conditions.reading.rainMmPerHour, snowCmPerHour: conditions.reading.snowCmPerHour } : weatherRatesFromIntensity(conditions.weather), [conditions.mode, conditions.reading, conditions.weather]);
  const [locationPreview, setLocationPreview] = useState<LocationPreviewData | null>(null);
  const [items, setItems] = useState<Disruption[]>([]);
  for (const item of items) if (!placedAtRef.current.has(item.id)) placedAtRef.current.set(item.id, { date: clockRef.current.date, minutes: Math.floor(clockRef.current.minutes) });
  for (const id of placedAtRef.current.keys()) if (!items.some(item => item.id === id)) placedAtRef.current.delete(id);
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
        <WorkspaceMenus map={map} items={items} setItems={setItems} onInteractionChange={setInteracting} conditions={conditions} presentTime={presentTime} clock={clock} placedAt={placedAtRef.current} />
        <TrafficChat onPreview={setLocationPreview} getMapReference={() => { const p = map.getCenter(); return [p.lng, p.lat]; }} context={chatContext} items={items} weather={trafficWeather} onApply={proposals => { if (items.length + proposals.length > 20) return false; setItems(current => [...current, ...proposals]); return true; }} />
        <TrafficOverlay weather={trafficWeather} map={map} renderer={renderer} items={items} interacting={interacting} onLightChange={setLight} onPresentTimeChange={setPresentTime} buildingFade={buildingFade} onChatContext={setChatContext} clockRef={clockRef} placedAtRef={placedAtRef} onClockChange={setClock} />
      </WorkspaceLayout>
    </>
  );
}

function WorkspaceMenus({ map, items, setItems, onInteractionChange, conditions, presentTime, clock, placedAt }: {
  map: MapboxMap | MapLibreMap;
  items: Disruption[];
  setItems: import("react").Dispatch<import("react").SetStateAction<Disruption[]>>;
  onInteractionChange: (active: boolean) => void;
  conditions: ReturnType<typeof useCurrentWeather>;
  presentTime: boolean;
  clock: ClockState;
  placedAt: ReadonlyMap<string, DisruptionPlacement>;
}) {
  const { panel, setPanel } = useWorkspaceLayout();
  const openToolbox = useCallback((open: boolean) => setPanel(open ? "toolbox" : null), [setPanel]);
  const openWeather = useCallback((open: boolean) => setPanel(open ? "weather" : null), [setPanel]);
  return <>
    <DisruptionToolbox map={map} items={items} setItems={setItems} onInteractionChange={onInteractionChange} open={panel === "toolbox"} onOpenChange={openToolbox} suspended={panel !== "toolbox" && panel !== "editor"} clock={clock} placedAt={placedAt} />
    <WeatherMenu open={panel === "weather"} onOpenChange={openWeather} weather={conditions.weather} onChange={conditions.manualWeather} mode={conditions.mode} reading={conditions.reading} status={conditions.status} presentTime={presentTime} onModeChange={conditions.chooseMode} onRefresh={conditions.refresh} />
  </>;
}
