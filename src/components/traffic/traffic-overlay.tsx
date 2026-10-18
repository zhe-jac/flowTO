"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer } from "@deck.gl/layers";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WeatherRates } from "@/lib/weather";
import type { Disruption } from "@/lib/disruptions";
import type { DisruptionMap } from "@/lib/disruption-map";
import { advancePlayback, changePlayback, type ClockState } from "@/lib/traffic/clock";
import { simulatorLight, type SimulatorLight } from "@/lib/daylight";
import { CLASS_WIDTHS, congestionColor } from "@/lib/traffic/colors";
import { closedRoadIds } from "@/lib/traffic/disruptions";
import { continuousPulseOffset, PULSE_SPACING } from "@/lib/traffic/flow-motion";
import { createTrafficViewport } from "@/lib/traffic/viewport";
import { congestionForState, discreteLevel, profileShare } from "@/lib/traffic/model";
import type { DayType, TrafficData, TrafficSegment } from "@/lib/traffic/types";
import { FlowPathLayer } from "./flow-path-layer";
import { useWorkspaceLayout, WorkspaceNotice } from "../workspace-layout";
import RoadPanel from "./road-panel";
import TrafficControls from "./traffic-controls";
import { impactPriority, impactedState } from "@/lib/traffic/rerouting";
import { disruptionStrength, disruptionWindow, type DisruptionPlacement } from "@/lib/traffic/scenario-timing";
import { formatClock } from "@/lib/traffic/model";
import { tweenValue, retargetTween, TimelineTransitions, COLOUR_TRANSITION_MS, HIGHLIGHT_TRANSITION_MS, type VisualTween } from "@/lib/traffic/visual-transition";
import { worsenedTraffic } from "@/lib/traffic/traffic-emphasis";
import { comparisonImpacts } from "@/lib/traffic/comparison";
import { enrichTrafficData, suppressedVenues } from "@/lib/traffic/activity";
import { useRerouting } from "./use-rerouting";
import type { ChatTrafficContext } from "@/lib/traffic/chat";
import { dateAtNoon, shiftSimulationDate } from "@/lib/traffic/simulation-date";
import { buildingFadeStrength } from "@/lib/building-fade";
import type { BuildingFadeController } from "@/lib/building-fade-layer";
import { BuildingFadeExtension } from "./building-fade-extension";
const FLAT_DEPTH = { depthCompare: "always", depthWriteEnabled: false } as const;
const TILTED_DEPTH = { depthCompare: "less-equal", depthWriteEnabled: false } as const;
const OCCLUDED_DEPTH = { depthCompare: "greater", depthWriteEnabled: false } as const;
const OFFSET_EXTENSION = new PathStyleExtension({ offset: true });

const HIGHLIGHT_WIDTH = 1.22;
/** Highlighted roads are drawn at least as wide as an arterial, so small streets do not stay thin. */
const HIGHLIGHT_MIN_BASE = 7;
/** How much unaffected roads fade while a scenario's affected roads are highlighted. */
/** Milliseconds for road colours to switch when toggling Before/After. */
const COMPARE_TRANSITION_MS = 300;
const DIM_STRENGTH = 0.45;
type Flow = {
    index: number;
    segment: number;
    path: [
        number,
        number
    ][];
    width: number;
    direction: 1 | -1;
    twoWay: boolean;
    local: boolean;
    collector: boolean;
};
type Snapshot = {
    clock: ClockState;
    vehicles: number;
};
type TrafficMap = DisruptionMap & Pick<MapboxMap | MapLibreMap, "addControl" | "removeControl" | "getBounds">;
type Props = {
    map: TrafficMap;
    renderer: "mapbox" | "maplibre";
    items: Disruption[];
    interacting: boolean;
    weather: WeatherRates;
    onLightChange: (light: SimulatorLight) => void;
    onPresentTimeChange: (current: boolean) => void;
    buildingFade: BuildingFadeController | null;
    onChatContext: (context: ChatTrafficContext) => void;
    clockRef: RefObject<ClockState>;
    placedAtRef: RefObject<Map<string, DisruptionPlacement>>;
    onClockChange: (clock: ClockState) => void;
};
function buildFlows(segments: TrafficSegment[]) {
    const flows: Flow[] = [];
    segments.forEach((segment, index) => {
        const forward = segment.coords as [
            number,
            number
        ][];
        const directions = segment.oneway === 0 ? [forward, [...forward].reverse()] : [segment.oneway === 1 ? forward : [...forward].reverse()];
        for (const path of directions)
            flows.push({ index: flows.length, segment: index, path, direction: path === forward ? 1 : -1, width: CLASS_WIDTHS[segment.cls] ?? 3, twoWay: segment.oneway === 0, local: segment.cls === "Local", collector: segment.cls.startsWith("Collector") });
    });
    return flows;
}
export default function TrafficOverlay({ map, renderer, items, interacting, onLightChange, onPresentTimeChange, buildingFade, weather, onChatContext, clockRef, placedAtRef, onClockChange }: Props) {
    const { panel, setPanel } = useWorkspaceLayout();
    const [data, setData] = useState<TrafficData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [playbackNotice, setPlaybackNotice] = useState<string | null>(null);
    const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ clock: clockRef.current, vehicles: 0 }));

    useEffect(() => { onClockChange(snapshot.clock); }, [snapshot.clock, onClockChange]);

    useEffect(() => { onPresentTimeChange(snapshot.clock.rate.id === "live"); }, [snapshot.clock.rate.id, onPresentTimeChange]);

    const simulationDate = useMemo(() => dateAtNoon(snapshot.clock.date), [snapshot.clock.date]);
    const light = simulatorLight(snapshot.clock.minutes, simulationDate);
    const lightKey = `${light.phase}:${light.daylight}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lightKey captures every field of light.
    useEffect(() => { onLightChange(light); }, [lightKey, onLightChange]);
    const timelineRef = useRef<TimelineTransitions | null>(null);
    timelineRef.current ??= new TimelineTransitions();
    const timelineRevision = timelineRef.current.revision;
    const selectedRef = useRef<number | null>(null);
    const redrawRef = useRef<() => void>(() => { });
    const closed = useMemo(() => closedRoadIds(items), [items]);
    const [compare, setCompare] = useState<"before" | "after">("after");
    const strengths = items.map((item) => disruptionStrength(item, placedAtRef.current.get(item.id) ?? snapshot.clock.minutes, snapshot.clock.minutes, snapshot.clock.date));
    const nextStart = items.map((item, i) => strengths[i] > 0 ? null : disruptionWindow(item, placedAtRef.current.get(item.id) ?? 0, snapshot.clock.date).start).filter((start): start is number => start !== null && start > snapshot.clock.minutes).sort((a, b) => a - b)[0] ?? null;
    const rerouting = useRerouting(items, snapshot.clock.day, snapshot.clock.minutes, weather, snapshot.clock.date, placedAtRef.current);
    const waiting = rerouting.loading || !!rerouting.error || interacting;
    useLayoutEffect(() => {
        if (!waiting || !clockRef.current.playing) return;
        clockRef.current = { ...clockRef.current, playing: false };
        setSnapshot(previous => ({ ...previous, clock: clockRef.current }));
    }, [waiting, clockRef]);
    useEffect(() => { setPlaybackNotice(null); }, [rerouting.loading, rerouting.error, interacting]);
    useEffect(() => {
        if (!playbackNotice) return;
        const timer = setTimeout(() => setPlaybackNotice(null), 6000);
        return () => clearTimeout(timer);
    }, [playbackNotice]);
    const impacts = rerouting.plan?.impacts;
    const impactKey = useMemo(() => rerouting.plan?.simulation ? `${rerouting.plan.simulation.runKey}:${rerouting.plan.simulation.minute}` : JSON.stringify(rerouting.plan ?? {}), [rerouting.plan]);
    const displayed = comparisonImpacts(rerouting.plan, items, placedAtRef.current, snapshot.clock.minutes, compare, snapshot.clock.date);
    const chatMinute = Math.floor(snapshot.clock.minutes);
    const chatKey = useMemo(() => JSON.stringify({ date: snapshot.clock.date, minutes: chatMinute, day: snapshot.clock.day, source: rerouting.loading ? "pending" : rerouting.plan?.source ?? "baseline", impacts: Object.fromEntries(Object.entries(compare === "after" ? rerouting.plan?.impacts ?? {} : {}).sort((a, b) => impactPriority(b[1]) - impactPriority(a[1])).slice(0, 100)) }), [chatMinute, snapshot.clock.date, snapshot.clock.day, rerouting.loading, rerouting.plan, compare]);
    useEffect(() => {
        onChatContext(JSON.parse(chatKey));
    }, [chatKey, onChatContext]);
    const closureKey = [...closed].sort().join(",") + impactKey;
    const latestRef = useRef({ closed, closureKey, interacting, impacts, items, compare, weather, plan: rerouting.plan, loading: rerouting.loading, waiting, timelineRevision });
    useLayoutEffect(() => {
        latestRef.current = { closed, closureKey, interacting, impacts, items, compare, weather, plan: rerouting.plan, loading: rerouting.loading, waiting, timelineRevision };
        if (interacting) {
            selectedRef.current = null;
            setSelected(null);
        }
        redrawRef.current();
    }, [closed, closureKey, interacting, impacts, items, compare, weather, rerouting.plan, rerouting.loading, waiting, timelineRevision]);
    useEffect(() => {
        selectedRef.current = selected;
        redrawRef.current();
    }, [selected]);
    useEffect(() => {
        const controller = new AbortController();
        setError(null);
        fetch("/data/traffic.json", { signal: controller.signal })
            .then(async (response) => {
            if (!response.ok)
                throw new Error("Traffic estimates could not load. Try again.");
            const result = await response.json() as TrafficData;
            if (!result.segments?.length || result.profiles?.weekday?.length !== 96 || result.profiles?.weekend?.length !== 96)
                throw new Error("Traffic estimates are unavailable. Try again.");
            if (!controller.signal.aborted)
                setData(enrichTrafficData(result));
        })
            .catch((cause: unknown) => { if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : "Traffic estimates could not load."); });
        return () => controller.abort();
    }, [retry]);
    useEffect(() => {
        if (!data)
            return;
        const segments = data.segments;
        const flows = buildFlows(segments);
        const viewport = createTrafficViewport(segments);
        const flowsBySegment: Flow[][] = segments.map(() => []);
        for (const flow of flows) flowsBySegment[flow.segment].push(flow);
        const flowColors = new Uint8Array(flows.length * 4);
        const flowSpeeds = new Float32Array(flows.length);
        const flowPhases = flows.map((flow) => (((Math.sin(flow.index * 12.9898) * 43758.5453) % 1 + 1) % 1) * PULSE_SPACING);
        const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
        let disposed = false;
        let frame = 0;
        let timer = 0;
        let last = performance.now();
        let lastState = -Infinity;
        let lastUi = -Infinity;
        let stateMinutes = NaN;
        let stateDay = "";
        let stateClosures: string | null = null;
        let colorVersion = 0;
        let paramVersion = 0;
        let vehicles = 0;
        let animationTime = 0;
        let mainFlows: Flow[] = [];
        let collectorFlows: Flow[] = [];
        let localFlows: Flow[] = [];
        let visibleSegments: number[] | null = null;
        let visibleClosures: string | null = null;
        let viewDirty = true;
        let detach = () => { };
        const segmentIndex = new Map(segments.map((segment, index) => [segment.id, index]));
        const targetLevels = new Float32Array(flows.length);
        let lastCompareMode: "before" | "after" | null = null;
        let effectiveClosed = new Set<string>();
        let closedDirections = new Set<string>();
        let effectiveKey = "";
        let trackedFlows = new Set<number>();
        let highlighted = new Set<number>();
        let dim = 0;
        const colourTweens = new Map<number, VisualTween>();
        const emphasisTweens = new Map<number, VisualTween>();
        const visualLevels = new Map<number, number>();
        const visualEmphasis = new Map<number, number>();
        let visualVersion = 0;
        let visualMoving = false;
        let snapFrame = false;
        const refreshState = () => {
            const { minutes, day, date } = clockRef.current;
            const { closureKey, items: scenarioItems, compare: mode, weather } = latestRef.current;
            const timeline = timelineRef.current!;
            const immediate = timeline.immediate || preference.matches;
            const strengths = scenarioItems.map((item) => mode === "before" ? 0 : disruptionStrength(item, placedAtRef.current.get(item.id) ?? minutes, minutes, date));
            const activity = { minutes, date, suppressedVenues: suppressedVenues(scenarioItems.filter((_, i) => strengths[i] > 0)) };
            const activeKey = `${timeline.revision}:${latestRef.current.timelineRevision}:${latestRef.current.loading}:${timeline.immediate}:${timeline.dragging}|${date}|${closureKey}|${mode}|${weather.rainMmPerHour},${weather.snowCmPerHour}|${scenarioItems.map((item, i) => strengths[i] > 0 ? item.id : "").join(",")}`;
            if (day === stateDay && Math.abs(minutes - stateMinutes) < 0.5 && stateClosures === activeKey)
                return;
            snapFrame = immediate;
            stateMinutes = minutes;
            stateDay = day;
            stateClosures = activeKey;
            const baseline = comparisonImpacts(latestRef.current.plan, scenarioItems, placedAtRef.current, minutes, "before", date);
            const scenario = comparisonImpacts(latestRef.current.plan, scenarioItems, placedAtRef.current, minutes, "after", date);
            const effective = mode === "before" ? baseline : scenario;
            effectiveClosed = effective.closed;
            closedDirections = new Set(Object.entries(effective.impacts).flatMap(([id, impact]) => impact.statesByDirection?.flatMap((state, i) => state?.capacity === 0 ? [`${id}:${i === 0 ? 1 : -1}`] : []) ?? []));
            effectiveKey = [...effectiveClosed, ...closedDirections].sort().join(",");

            const impacts = effective.impacts;
            const share = profileShare(data.profiles[day], minutes);
            const segmentStates = segments.map(segment => impactedState(segment, share, day, impacts[segment.id], weather, activity));
            const states = flows.map(flow => segments[flow.segment].oneway === 0 && (impacts[segments[flow.segment].id]?.addedByDirection || impacts[segments[flow.segment].id]?.statesByDirection) ? impactedState(segments[flow.segment], share, day, impacts[segments[flow.segment].id], weather, activity, flow.direction) : segmentStates[flow.segment]);
            states.forEach((state, index) => { targetLevels[index] = congestionForState(state); });
            vehicles = flows.reduce((sum, flow) => {
                const state = states[flow.index];
                return sum + ("vehicles" in state ? Number(state.vehicles) : effectiveClosed.has(segments[flow.segment].id) ? 0 : state.flow / Math.max(1, state.speedKmh) * segments[flow.segment].lengthM / 1000);
            }, 0);
            let colorsChanged = false;
            let speedsChanged = false;
            flows.forEach((flow, index) => {
                const state = states[index];
                const [r, g, b] = congestionColor(targetLevels[index]);
                const alpha = flow.local ? 155 : flow.collector ? 190 : 225;
                const offset = index * 4;
                if (flowColors[offset] !== r || flowColors[offset + 1] !== g || flowColors[offset + 2] !== b || flowColors[offset + 3] !== alpha) {
                    flowColors.set([r, g, b, alpha], offset);
                    colorsChanged = true;
                }
                const speed = Math.round(Math.max(0, state.speedKmh / 7) * 4) / 4;
                if (flowSpeeds[index] !== speed) {
                    flowPhases[index] = continuousPulseOffset(flowPhases[index], flowSpeeds[index], speed, animationTime);
                    flowSpeeds[index] = speed;
                    speedsChanged = true;
                }
            });
            if (colorsChanged)
                colorVersion++;
            if (speedsChanged)
                paramVersion++;
            const affectedIds = Object.keys(latestRef.current.plan?.impacts ?? {});
            const currentFlows = new Set<number>();
            const nextHighlights = new Set<number>();
            const now = performance.now();
            const comparing = lastCompareMode !== null && lastCompareMode !== mode;
            lastCompareMode = mode;
            const colourDuration = immediate ? 0 : comparing ? COMPARE_TRANSITION_MS : COLOUR_TRANSITION_MS;
            for (const id of affectedIds) {
                const index = segmentIndex.get(id);
                if (index === undefined) continue;
                for (const flow of flowsBySegment[index]) {
                    if (effectiveClosed.has(id) || closedDirections.has(`${id}:${flow.direction}`)) continue;
                    const before = impactedState(segments[index], share, day, baseline.impacts[id], weather, activity, flow.direction);
                    const after = impactedState(segments[index], share, day, scenario.impacts[id], weather, activity, flow.direction);
                    const emphasize = mode === "after" && worsenedTraffic(before, after, !immediate && highlighted.has(flow.index));
                    if (emphasize) nextHighlights.add(flow.index);
                    const initial = congestionForState(before);
                    const target = emphasize ? discreteLevel(targetLevels[flow.index]) : targetLevels[flow.index];
                    currentFlows.add(flow.index);
                    colourTweens.set(flow.index, retargetTween(colourTweens.get(flow.index), target, now, colourDuration, initial));
                    emphasisTweens.set(flow.index, retargetTween(emphasisTweens.get(flow.index), emphasize ? 1 : 0, now, immediate ? 0 : comparing ? COMPARE_TRANSITION_MS : HIGHLIGHT_TRANSITION_MS, 0));
                }
            }
            for (const flowIndex of trackedFlows) if (!currentFlows.has(flowIndex)) {
                const flow = flows[flowIndex];
                if (effectiveClosed.has(segments[flow.segment].id) || closedDirections.has(`${segments[flow.segment].id}:${flow.direction}`)) continue;
                const previous = emphasisTweens.get(flow.index);
                if (immediate || !previous || tweenValue(previous, now) <= 0) continue;
                currentFlows.add(flow.index);
                const target = targetLevels[flow.index];
                colourTweens.set(flow.index, retargetTween(colourTweens.get(flow.index), target, now, colourDuration, target));
                emphasisTweens.set(flow.index, retargetTween(previous, 0, now, immediate ? 0 : comparing ? COMPARE_TRANSITION_MS : HIGHLIGHT_TRANSITION_MS, 0));
            }
            highlighted = nextHighlights;
            for (const index of emphasisTweens.keys()) if (!currentFlows.has(index)) {
                emphasisTweens.delete(index);
                visualEmphasis.delete(index);
                colourTweens.delete(index);
                visualLevels.delete(index);
                visualVersion++;
            }
            trackedFlows = currentFlows;
            timeline.settle(latestRef.current.timelineRevision, latestRef.current.loading);
        };
        const ribbonWidth = (flow: Flow) => flow.width + (Math.max(flow.width, HIGHLIGHT_MIN_BASE) * HIGHLIGHT_WIDTH - flow.width) * (visualEmphasis.get(flow.index) ?? 0);
        const ribbonColor = (flow: Flow): [number, number, number, number] => {
            const offset = flow.index * 4;
            const emphasis = visualEmphasis.get(flow.index) ?? 0;
            const level = visualLevels.get(flow.index);
            const normal = level === undefined ? [flowColors[offset], flowColors[offset + 1], flowColors[offset + 2]] : congestionColor(level);
            const vivid = congestionColor(level ?? targetLevels[flow.index], true);
            const [r, g, b] = normal.map((channel, i) => channel + (vivid[i] - channel) * emphasis);
            const alpha = flowColors[offset + 3] + (255 - flowColors[offset + 3]) * emphasis;
            return [r, g, b, alpha * (1 - DIM_STRENGTH * dim * (1 - emphasis))];
        };
        const roadPick = (info: PickingInfo<Flow>) => {
            if (latestRef.current.interacting || map.getCanvas().parentElement?.dataset.disruptionInteraction === "true")
                return;
            if (map.getLayer("disruption-applied-line") && map.queryRenderedFeatures([[info.x - 5, info.y - 5], [info.x + 5, info.y + 5]], { layers: ["disruption-applied-line", "disruption-applied-locations"] }).length)
                return;
            const segment = info.layer?.id.startsWith("traffic-flow") && info.object ? info.object.segment : null;
            setSelected(segment);
            setPanel(current => segment !== null ? "road" : current === "road" ? null : current);
        };
        async function initialize() {
            const Overlay = renderer === "mapbox" ? (await import("@deck.gl/mapbox")).MapboxOverlay : (await import("@deck.gl/maplibre")).MapLibreOverlay;
            if (disposed)
                return;
            const overlay = new Overlay({ interleaved: true, pickingRadius: 8, onClick: roadPick, getCursor: ({ isHovering, isDragging }) => latestRef.current.interacting ? "crosshair" : isDragging ? "grabbing" : isHovering ? "pointer" : "grab", layers: [], onError: () => setError("Traffic rendering is unavailable. The map and disruption tools are still available.") });
            const placement = renderer === "mapbox" ? { slot: "middle" as const } : { beforeId: "outside-toronto-mask" };
            const fadePlacement = renderer === "mapbox" ? { slot: "top" as const, beforeId: "toronto-road-labels" } : { beforeId: map.getStyle()?.layers?.find(layer => layer.type === "symbol")?.id };
            const fadeExtension = buildingFade ? new BuildingFadeExtension({ canvas: map.getCanvas(), getFocus: buildingFade.getFocus }) : null;
            detach = () => { try {
                map.removeControl(overlay as never);
            }
            catch {
                overlay.finalize();
            } };
            map.addControl(overlay as never);
            const tick = (now: number) => {
                if (disposed || document.hidden)
                    return;
                const seconds = Math.min(0.5, (now - last) / 1000);
                last = now;
                clockRef.current = advancePlayback(clockRef.current, seconds, { waiting: latestRef.current.waiting, scrubbing: timelineRef.current!.dragging });
                if (!preference.matches && clockRef.current.playing)
                    animationTime += Math.min(seconds, 0.1);
                if (now - lastState >= 250) {
                    refreshState();
                    lastState = now;
                }
                const zoom = map.getZoom();
                const bounds = viewDirty || visibleClosures !== effectiveKey ? map.getBounds() : null;
                if (bounds) {
                    viewDirty = false;
                    const next = viewport.select([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
                    if (next !== visibleSegments || visibleClosures !== effectiveKey) {
                        visibleSegments = next;
                        buildingFade?.setRoads(next.map(index => segments[index]));
                        visibleClosures = effectiveKey;
                        mainFlows = [];
                        collectorFlows = [];
                        localFlows = [];
                        for (const index of next) {
                            if (effectiveClosed.has(segments[index].id)) continue;
                            for (const flow of flowsBySegment[index]) {
                                if (closedDirections.has(`${segments[index].id}:${flow.direction}`)) continue;
                                if (flow.local) localFlows.push(flow);
                                else if (flow.collector) collectorFlows.push(flow);
                                else mainFlows.push(flow);
                            }
                        }
                    }
                }
                const depth = map.getPitch() >= 5 ? TILTED_DEPTH : FLAT_DEPTH;
                const widthScale = Math.min(1.25, Math.max(0.28, 2 ** ((zoom - 15.5) * 0.5)));
                const collectorOpacity = Math.max(0, Math.min(1, (zoom - 12.8) / 1.0));
                const localOpacity = Math.max(0, Math.min(1, (zoom - 14.2) / 1.0));
                const layers: Layer[] = [];
                const chosen = selectedRef.current;
                if (chosen !== null && segments[chosen] && !effectiveClosed.has(segments[chosen].id))
                    layers.push(new PathLayer<Flow>({ id: "traffic-selected", ...placement, parameters: depth, data: flowsBySegment[chosen], getPath: (flow) => flow.path, getColor: [79, 139, 177, 90], getWidth: (flow) => flow.width * (flow.twoWay ? 2.3 : 1) + 4, widthUnits: "pixels", widthScale, capRounded: true, jointRounded: true, antialiasing: true }));
                visualMoving = false;
                let visualsChanged = false;
                for (const [index, tween] of colourTweens) {
                    const value = tweenValue(tween, now);
                    if (visualLevels.get(index) !== value) visualsChanged = true;
                    visualLevels.set(index, value);
                    if (now < tween.started + tween.duration) visualMoving = true;
                }
                for (const [index, tween] of emphasisTweens) {
                    const value = tweenValue(tween, now);
                    if (visualEmphasis.get(index) !== value) visualsChanged = true;
                    visualEmphasis.set(index, value);
                    if (now < tween.started + tween.duration) visualMoving = true;
                }
                if (visualsChanged) visualVersion++;
                const emphasis = highlighted.size ? 1 : 0;
                dim = snapFrame || timelineRef.current!.dragging || preference.matches ? emphasis : dim + (emphasis - dim) * Math.min(1, seconds * 4);
                snapFrame = false;
                const flowLayer = (id: string, layerData: Flow[], opacity: number) => new FlowPathLayer<Flow>({
                    id, ...placement, visible: opacity > 0, opacity, parameters: depth, data: layerData,
                    getPath: (flow) => flow.path,
                    getColor: ribbonColor,
                    getWidth: ribbonWidth,
                    getOffset: flow => flow.twoWay ? -0.6 * flow.width / ribbonWidth(flow) : 0,
                    getFlowParams: (flow) => [flowSpeeds[flow.index], flowPhases[flow.index]],
                    time: animationTime, pulseSpacing: PULSE_SPACING, widthUnits: "pixels", widthScale, widthMinPixels: 1.1, widthMaxPixels: 12, capRounded: true, jointRounded: true, antialiasing: true,
                    pickable: !latestRef.current.interacting && opacity > 0.2, autoHighlight: !latestRef.current.interacting, highlightColor: [224, 243, 255, 45], extensions: [OFFSET_EXTENSION],
                    updateTriggers: { getColor: [colorVersion, visualVersion, dim], getFlowParams: paramVersion, getWidth: visualVersion, getOffset: visualVersion },
                });

                layers.push(flowLayer("traffic-flow-local", localFlows, localOpacity), flowLayer("traffic-flow-collectors", collectorFlows, collectorOpacity), flowLayer("traffic-flow", mainFlows, 1));
                const fadeOpacity = buildingFade ? buildingFadeStrength(map.getPitch()) : 0;
                if (fadeOpacity > 0 && fadeExtension) {
                    const throughBuildings = layers.map(layer => layer.clone({ id: `${layer.id}-through-buildings`, ...fadePlacement, parameters: OCCLUDED_DEPTH, opacity: (layer.props.opacity ?? 1) * fadeOpacity, pickable: false, autoHighlight: false, extensions: [...(layer.props.extensions ?? []), fadeExtension] }));
                    layers.push(...throughBuildings);
                }
                overlay.setProps({ layers });
                if (now - lastUi >= 250) {
                    lastUi = now;
                    const clock = clockRef.current;
                    setSnapshot((previous) => Math.floor(previous.clock.minutes) === Math.floor(clock.minutes) && previous.clock.day === clock.day && previous.clock.date === clock.date && previous.clock.playing === clock.playing && previous.clock.rate.id === clock.rate.id && Math.round(previous.vehicles) === Math.round(vehicles) ? previous : { clock, vehicles });
                }
                if (!visualMoving && (preference.matches || !clockRef.current.playing) && Math.abs(dim - (highlighted.size ? 1 : 0)) < 0.01)
                    timer = window.setTimeout(() => tick(performance.now()), 250);
                else
                    frame = requestAnimationFrame(tick);
            };
            const redraw = () => {
                cancelAnimationFrame(frame);
                clearTimeout(timer);
                lastState = -Infinity;
                lastUi = -Infinity;
                viewDirty = true;
                if (!document.hidden) {
                    frame = requestAnimationFrame(tick);
                }
            };
            const visibility = () => { cancelAnimationFrame(frame); clearTimeout(timer); if (!document.hidden) {
                last = performance.now();
                redraw();
            } };
            redrawRef.current = redraw;
            document.addEventListener("visibilitychange", visibility);
            preference.addEventListener("change", redraw);
            map.on("move", redraw);
            map.on("resize", redraw);
            const removeOverlay = detach;
            detach = () => { document.removeEventListener("visibilitychange", visibility); preference.removeEventListener("change", redraw); map.off("move", redraw); map.off("resize", redraw); removeOverlay(); };
            redraw();
        }
        void initialize().catch(() => { if (!disposed)
            setError("Traffic rendering is unavailable. The map and disruption tools are still available."); });
        return () => { disposed = true; cancelAnimationFrame(frame); clearTimeout(timer); redrawRef.current = () => { }; detach(); buildingFade?.setRoads([]); };
    }, [data, map, renderer, retry, buildingFade, setPanel, clockRef, placedAtRef]);
    const updateClock = (change: Partial<ClockState>) => {
        if (change.minutes !== undefined || change.date !== undefined) timelineRef.current!.seek();
        const next = changePlayback(clockRef.current, change, { loading: rerouting.loading, editing: interacting, failed: !!rerouting.error });
        clockRef.current = next.clock;
        setPlaybackNotice(next.notice);
        setSnapshot((previous) => ({ ...previous, clock: clockRef.current }));
        redrawRef.current();
    };
    const changeScrubbing = (dragging: boolean) => {
        timelineRef.current!.dragging = dragging;
        redrawRef.current();
    };
    const selectedSegment = data && selected !== null && !interacting && panel === "road" ? data.segments[selected] : null;
    return (<div className="traffic-ui" data-interacting={interacting}>
      {data ? <TrafficControls clock={snapshot.clock} waiting={waiting} profile={data.profiles[snapshot.clock.day]} vehicles={snapshot.vehicles} disruptions={compare === "after" ? strengths.filter(value => value > 0).length : 0} onChange={updateClock} onScrubbingChange={changeScrubbing} scenario={items.length || rerouting.plan ? { text: [compare === "before" ? "Showing before disruptions" : !rerouting.plan?.simulation && strengths.every((value) => value === 0) && nextStart !== null ? `Disruptions start ${nextStart >= 1440 ? `${shiftSimulationDate(snapshot.clock.date, Math.floor(nextStart / 1440))} at ` : "at "}${formatClock(nextStart)}` : rerouting.plan?.simulation && strengths.every(value => value === 0) && rerouting.plan.simulation.ledger.onNetwork > rerouting.plan.simulation.baselineLedger.onNetwork + 1 ? "Queues clearing" : !rerouting.plan?.simulation && Math.max(...strengths) < 1 ? "Effects building up" : null, rerouting.loading ? "Simulating traffic…" : rerouting.error ?? (rerouting.plan?.warning ? "Local diversion estimate (Gemini unavailable)" : rerouting.plan?.source === "solver" ? "Dynamic traffic estimate" : "Local diversion estimate")].filter(Boolean).join(" · "), retry: rerouting.error || rerouting.plan?.warning ? rerouting.retry : undefined, compare, onCompare: setCompare } : null} /> : null}
      {selectedSegment && data ? <RoadPanel key={selectedSegment.id} activity={{ minutes: snapshot.clock.minutes, date: snapshot.clock.date, suppressedVenues: compare === "after" ? suppressedVenues(items.filter((_, i) => strengths[i] > 0)) : [] }} weather={weather} segment={selectedSegment} data={data} clock={snapshot.clock} impact={displayed.impacts[selectedSegment.id]} closed={displayed.closed.has(selectedSegment.id)} onClose={() => { setSelected(null); setPanel(null); }}/> : null}
      {!data && !error ? <WorkspaceNotice><p className="traffic-status" role="status">Loading typical traffic…</p></WorkspaceNotice> : null}
      {playbackNotice ? <WorkspaceNotice><p className="closure-notice" role="status" data-map-ui>{playbackNotice}<button type="button" className="workspace-notice-dismiss" aria-label="Dismiss playback message" onClick={() => setPlaybackNotice(null)}>×</button></p></WorkspaceNotice> : null}
      {error ? <WorkspaceNotice><p className="traffic-status traffic-status-error" role="alert">{error} <button type="button" onClick={() => { setError(null); setRetry((value) => value + 1); }}>Retry</button></p></WorkspaceNotice> : null}
    </div>);
}
