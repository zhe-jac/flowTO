"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { advanceClock, CLOCK_RATES, torontoNow, type ClockState } from "@/lib/traffic/clock";
import { CLASS_WIDTHS, LEVEL_COLORS } from "@/lib/traffic/colors";
import { directionState, profileShare, vehiclesOnRoad } from "@/lib/traffic/model";
import type { TrafficData, TrafficSegment } from "@/lib/traffic/types";
import { createBuildingLayers, type BuildingSource } from "./building-layers";
import { FlowPathLayer } from "./flow-path-layer";
import RoadPanel from "./road-panel";
import TrafficControls from "./traffic-controls";
import TrafficLegend from "./traffic-legend";

/** The subset of the MapLibre and Mapbox map APIs the overlay needs. */
export type OverlayMap = {
  addControl(control: never): unknown;
  removeControl(control: never): unknown;
  getZoom(): number;
  getPitch(): number;
  getCenter(): { lat: number };
};

export type OverlayPlacement = { beforeId?: string; slot?: "bottom" | "middle" | "top" };

const FLAT_DEPTH = { depthCompare: "always", depthWriteEnabled: false } as const;
const TILTED_DEPTH = { depthCompare: "less-equal", depthWriteEnabled: false } as const;
const STATE_REFRESH_MS = 250;
const UI_REFRESH_MS = 250;
/** Simulated minutes between traffic-state refreshes; colours and speeds change slowly. */
const STATE_STEP_MINUTES = 0.5;
/** Two-way roads draw one tube per direction, shifted this many tube widths. Negative shifts right of travel, as Toronto drives. */
const TWO_WAY_OFFSET = -0.6;
const STREAK_SPACING = 3.2;
/** Local streets join the map once zoomed in far enough to read them. */
const LOCAL_STREET_ZOOM = 14.5;
const OFFSET_EXTENSION = new PathStyleExtension({ offset: true });

/** One direction of travel on one road segment, with its path ordered in the direction of travel. */
type Flow = {
  index: number;
  segment: number;
  path: [number, number][];
  width: number;
  twoWay: boolean;
  local: boolean;
};

function buildFlows(segments: TrafficSegment[]): Flow[] {
  const flows: Flow[] = [];
  segments.forEach((segment, index) => {
    const forward = segment.coords as [number, number][];
    const directions = segment.oneway === 0 ? [forward, [...forward].reverse()] : [segment.oneway === 1 ? forward : [...forward].reverse()];
    for (const path of directions) {
      flows.push({
        index: flows.length,
        segment: index,
        path,
        width: CLASS_WIDTHS[segment.cls] ?? 3,
        twoWay: segment.oneway === 0,
        local: segment.cls === "Local",
      });
    }
  });
  return flows;
}

type Snapshot = { clock: ClockState; vehicles: number };

/** deck.gl 9.4 reads `map.transform`, which MapLibre 6 moved to `map._camera.transform`. */
function exposeCameraTransform(map: OverlayMap) {
  const target = map as unknown as { transform?: unknown; _camera?: { transform?: unknown } };
  if (target.transform !== undefined || !target._camera) return;
  Object.defineProperty(target, "transform", { configurable: true, get: () => target._camera?.transform });
}

/** Starts at Toronto's current time. `?time=17:30&day=weekday&speed=5m` opens a specific moment, e.g. for a demo. */
function initialClock(): ClockState {
  const clock: ClockState = { ...torontoNow(), playing: true, rate: CLOCK_RATES[1] };
  const params = new URLSearchParams(window.location.search);
  const time = params.get("time")?.match(/^(\d{1,2}):(\d{2})$/);
  if (time && Number(time[1]) < 24 && Number(time[2]) < 60) clock.minutes = Number(time[1]) * 60 + Number(time[2]);
  const day = params.get("day");
  if (day === "weekday" || day === "weekend") clock.day = day;
  const rate = CLOCK_RATES.find((item) => item.id === params.get("speed"));
  if (rate) clock.rate = rate;
  if (clock.rate.id === "live" && (time || day)) clock.rate = CLOCK_RATES[1];
  return clock;
}

type Props = {
  map: OverlayMap;
  placement: OverlayPlacement;
  /** Vector tiles for the 3D buildings, which the overlay draws itself so tall ones can turn see-through. */
  loadBuildings: () => Promise<BuildingSource>;
};

export default function TrafficOverlay({ map, placement, loadBuildings }: Props) {
  const [data, setData] = useState<TrafficData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ clock: initialClock(), vehicles: 0 }));
  const clockRef = useRef<ClockState>(snapshot.clock);
  const selectedRef = useRef<number | null>(null);
  const vehiclesRef = useRef(0);
  selectedRef.current = selected;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/data/traffic.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Traffic data request failed (${response.status}). Run \`corepack pnpm data:traffic\`.`);
        return response.json() as Promise<TrafficData>;
      })
      .then(setData)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "Traffic data could not load.");
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!data) return;
    const segments = data.segments;
    const flows = buildFlows(segments);
    const flowColors = new Uint8Array(flows.length * 4);
    const flowSpeeds = new Float32Array(flows.length);
    // A fixed random phase per flow keeps neighbouring streaks from moving in lockstep.
    const flowPhases = flows.map((flow) => (Math.sin(flow.index * 12.9898) * 43758.5453) % 1);
    const mainFlows = flows.filter((flow) => !flow.local);
    const localFlows = flows.filter((flow) => flow.local);
    const colorOf = (index: number): [number, number, number, number] => [flowColors[index * 4], flowColors[index * 4 + 1], flowColors[index * 4 + 2], flowColors[index * 4 + 3]];
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stateMinutes = Number.NaN;
    let stateDay = "";
    let buildings: ReturnType<typeof createBuildingLayers> | null = null;
    let disposed = false;
    loadBuildings()
      .then((source) => { if (!disposed) buildings = createBuildingLayers(source); })
      .catch((cause: unknown) => console.warn("3D buildings unavailable:", cause));

    let colorVersion = 0;
    let paramVersion = 0;
    const refreshState = () => {
      const { minutes, day } = clockRef.current;
      if (day === stateDay && Math.abs(minutes - stateMinutes) < STATE_STEP_MINUTES) return;
      stateMinutes = minutes;
      stateDay = day;
      const share = profileShare(data.profiles[day], minutes);
      const states = segments.map((segment) => directionState(segment, share, day));
      vehiclesRef.current = segments.reduce((sum, segment) => sum + vehiclesOnRoad(segment, share, day), 0);
      // Only re-upload GPU attributes that visibly changed; the citywide network has ~80k flows.
      let colorsChanged = false;
      let speedsChanged = false;
      flows.forEach((flow, index) => {
        const state = states[flow.segment];
        const [r, g, b] = LEVEL_COLORS[state.level].road;
        const alpha = flow.local ? 170 : 240;
        const offset = index * 4;
        if (flowColors[offset] !== r || flowColors[offset + 1] !== g || flowColors[offset + 2] !== b || flowColors[offset + 3] !== alpha) {
          flowColors.set([r, g, b, alpha], offset);
          colorsChanged = true;
        }
        // Path widths per second, rounded so tiny changes don't trigger uploads: free-flowing roads stream, jammed ones crawl.
        const speed = Math.round(Math.max(0.2, state.speedKmh / 8) * 4) / 4;
        if (flowSpeeds[index] !== speed) {
          flowSpeeds[index] = speed;
          speedsChanged = true;
        }
      });
      if (colorsChanged) colorVersion++;
      if (speedsChanged) paramVersion++;
    };

    const roadPick = (info: PickingInfo<Flow>) => setSelected(info.layer?.id.startsWith("traffic-flow") && info.object ? info.object.segment : null);
    const overlay = new MapboxOverlay({
      interleaved: true,
      pickingRadius: 8,
      onClick: roadPick,
      getCursor: ({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab"),
      layers: [],
    });
    exposeCameraTransform(map);
    map.addControl(overlay as never);

    let frame = 0;
    let last = performance.now();
    let lastState = -Infinity;
    let lastUi = -Infinity;
    let animationTime = 0;
    const tick = (now: number) => {
      const seconds = Math.min(0.1, (now - last) / 1000);
      last = now;
      clockRef.current = advanceClock(clockRef.current, seconds);
      if (!reducedMotion) animationTime = (animationTime + seconds) % 3600;
      if (now - lastState >= STATE_REFRESH_MS) {
        refreshState();
        lastState = now;
      }
      const tilted = map.getPitch() >= 5;
      const zoom = map.getZoom();
      // Tubes keep their pixel width near street level and slim down as the view widens.
      const widthScale = Math.min(1.5, Math.max(0.3, 2 ** ((zoom - 15.5) * 0.75)));
      // Flat views draw traffic over the basemap; tilted views depth-test against the buildings.
      const depth = tilted ? TILTED_DEPTH : FLAT_DEPTH;
      const chosen = selectedRef.current;
      const layers: Layer[] = [];
      const buildingPasses = buildings?.(TILTED_DEPTH, tilted);
      if (buildingPasses) layers.push(buildingPasses.solid);
      if (chosen !== null && segments[chosen]) {
        layers.push(new PathLayer<Flow>({
          id: "traffic-selected",
          ...placement,
          parameters: depth,
          data: flows.filter((flow) => flow.segment === chosen),
          getPath: (flow) => flow.path,
          getColor: [31, 69, 97, 230],
          getWidth: (flow) => flow.width * (flow.twoWay ? 2.3 : 1) + 6,
          widthUnits: "pixels",
          widthScale,
          capRounded: true,
          jointRounded: true,
        }));
      }
      const flowLayer = (id: string, layerData: Flow[], visible: boolean) => new FlowPathLayer<Flow>({
        id,
        ...placement,
        visible,
        parameters: depth,
        data: layerData,
        getPath: (flow) => flow.path,
        getColor: (flow) => colorOf(flow.index),
        getWidth: (flow) => flow.width,
        getOffset: (flow) => (flow.twoWay ? TWO_WAY_OFFSET : 0),
        getFlowParams: (flow) => [flowSpeeds[flow.index], flowPhases[flow.index]],
        time: animationTime,
        arrowSpacing: STREAK_SPACING,
        // Flow ribbons lie flat on the street in both views for now.
        widthUnits: "pixels",
        widthScale,
        widthMinPixels: 1.5,
        capRounded: true,
        jointRounded: true,
        pickable: true,
        autoHighlight: true,
        highlightColor: [255, 255, 255, 70],
        extensions: [OFFSET_EXTENSION],
        updateTriggers: { getColor: colorVersion, getFlowParams: paramVersion },
      });
      layers.push(flowLayer("traffic-flow-local", localFlows, zoom >= LOCAL_STREET_ZOOM), flowLayer("traffic-flow", mainFlows, true));
      // See-through buildings draw last so the traffic behind them shows through.
      if (buildingPasses) layers.push(buildingPasses.ghost);
      overlay.setProps({ layers });
      if (now - lastUi >= UI_REFRESH_MS) {
        lastUi = now;
        setSnapshot({ clock: clockRef.current, vehicles: vehiclesRef.current });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      try {
        map.removeControl(overlay as never);
      } catch {
        // The map may already be removed when the whole page unmounts.
      }
    };
  }, [data, map, placement, loadBuildings]);

  const updateClock = (change: Partial<ClockState>) => {
    clockRef.current = { ...clockRef.current, ...change };
    setSnapshot((previous) => ({ ...previous, clock: clockRef.current }));
  };

  const selectedSegment = useMemo(() => (data && selected !== null ? data.segments[selected] : null), [data, selected]);

  return (
    <>
      {data ? (
        <>
          <TrafficControls clock={snapshot.clock} profile={data.profiles[snapshot.clock.day]} vehicles={snapshot.vehicles} onChange={updateClock} />
          <TrafficLegend meta={data.meta} />
        </>
      ) : null}
      {selectedSegment && data ? (
        <RoadPanel segment={selectedSegment} data={data} clock={snapshot.clock} onClose={() => setSelected(null)} />
      ) : null}
      {!data && !error ? <p className="traffic-status" role="status">Loading traffic counts…</p> : null}
      {error ? <p className="traffic-status traffic-status-error" role="alert">{error}</p> : null}
    </>
  );
}
