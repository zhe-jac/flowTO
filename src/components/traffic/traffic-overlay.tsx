"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer } from "@deck.gl/layers";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { WeatherRates } from "@/lib/weather";
import type { Disruption } from "@/lib/disruptions";
import type { DisruptionMap } from "@/lib/disruption-map";
import { advanceClock, initialTrafficClock, type ClockState } from "@/lib/traffic/clock";
import { simulatorLight, type SimulatorLight } from "@/lib/daylight";
import { CLASS_WIDTHS, congestionColor } from "@/lib/traffic/colors";
import { closedRoadIds } from "@/lib/traffic/disruptions";
import { continuousPulseOffset, PULSE_SPACING } from "@/lib/traffic/flow-motion";
import { createTrafficViewport } from "@/lib/traffic/viewport";
import { congestionForState, directionState, discreteLevel, profileShare } from "@/lib/traffic/model";
import type { DayType, TrafficData, TrafficSegment } from "@/lib/traffic/types";
import { FlowPathLayer } from "./flow-path-layer";
import { useWorkspaceLayout, WorkspaceNotice } from "../workspace-layout";
import RoadPanel from "./road-panel";
import TrafficControls from "./traffic-controls";
import { impactPriority, impactedState } from "@/lib/traffic/rerouting";
import { disruptionStrength, disruptionWindow, splitPath, type DisruptionPlacement } from "@/lib/traffic/scenario-timing";
import { formatClock } from "@/lib/traffic/model";
import { tweenValue, retargetTween, COLOUR_TRANSITION_MS, HIGHLIGHT_TRANSITION_MS, type VisualTween } from "@/lib/traffic/visual-transition";
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

/** Short pieces preserve the highlighted road geometry. */
const WAVE_PIECE_M = 2;
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
export default function TrafficOverlay({ map, renderer, items, interacting, onLightChange, onPresentTimeChange, buildingFade, weather, onChatContext }: Props) {
    const { panel, setPanel } = useWorkspaceLayout();
    const [data, setData] = useState<TrafficData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ clock: initialTrafficClock(window.location.search), vehicles: 0 }));

    useEffect(() => { onPresentTimeChange(snapshot.clock.rate.id === "live"); }, [snapshot.clock.rate.id, onPresentTimeChange]);

    const simulationDate = useMemo(() => dateAtNoon(snapshot.clock.date), [snapshot.clock.date]);
    const light = simulatorLight(snapshot.clock.minutes, simulationDate);
    const lightKey = `${light.phase}:${light.daylight}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lightKey captures every field of light.
    useEffect(() => { onLightChange(light); }, [lightKey, onLightChange]);
    const clockRef = useRef(snapshot.clock);
    const selectedRef = useRef<number | null>(null);
    const redrawRef = useRef<() => void>(() => { });
    const closed = useMemo(() => closedRoadIds(items), [items]);
    const placedAtRef = useRef(new Map<string, DisruptionPlacement>());
    for (const item of items) if (!placedAtRef.current.has(item.id)) placedAtRef.current.set(item.id, { date: clockRef.current.date, minutes: Math.floor(clockRef.current.minutes) });
    for (const id of [...placedAtRef.current.keys()]) if (!items.some((item) => item.id === id)) placedAtRef.current.delete(id);
    const [compare, setCompare] = useState<"before" | "after">("after");
    const strengths = items.map((item) => disruptionStrength(item, placedAtRef.current.get(item.id) ?? snapshot.clock.minutes, snapshot.clock.minutes, snapshot.clock.date));
    const nextStart = items.map((item, i) => strengths[i] > 0 ? null : disruptionWindow(item, placedAtRef.current.get(item.id) ?? 0, snapshot.clock.date).start).filter((start): start is number => start !== null && start > snapshot.clock.minutes).sort((a, b) => a - b)[0] ?? null;
    const rerouting = useRerouting(items, snapshot.clock.day, snapshot.clock.minutes, weather, snapshot.clock.date, placedAtRef.current);
    const impacts = rerouting.plan?.impacts;
    const impactKey = useMemo(() => rerouting.plan?.simulation ? `${rerouting.plan.simulation.runKey}:${rerouting.plan.simulation.minute}` : JSON.stringify(rerouting.plan ?? {}), [rerouting.plan]);
    const displayed = comparisonImpacts(rerouting.plan, items, placedAtRef.current, snapshot.clock.minutes, compare, snapshot.clock.date);
    const chatMinute = Math.floor(snapshot.clock.minutes);
    const chatKey = useMemo(() => JSON.stringify({ date: snapshot.clock.date, minutes: chatMinute, day: snapshot.clock.day, source: rerouting.loading ? "pending" : rerouting.plan?.source ?? "baseline", impacts: Object.fromEntries(Object.entries(compare === "after" ? rerouting.plan?.impacts ?? {} : {}).sort((a, b) => impactPriority(b[1]) - impactPriority(a[1])).slice(0, 100)) }), [chatMinute, snapshot.clock.date, snapshot.clock.day, rerouting.loading, rerouting.plan, compare]);
    useEffect(() => {
        onChatContext(JSON.parse(chatKey));
    }, [chatKey, onChatContext]);
    const closureKey = [...closed].sort().join(",") + impactKey;
    const latestRef = useRef({ closed, closureKey, interacting, impacts, items, compare, weather, plan: rerouting.plan });
    useEffect(() => {
        latestRef.current = { closed, closureKey, interacting, impacts, items, compare, weather, plan: rerouting.plan };
        if (interacting) {
            selectedRef.current = null;
            setSelected(null);
        }
        redrawRef.current();
    }, [closed, closureKey, interacting, impacts, items, compare, weather, rerouting.plan]);
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
        // Highlight the affected area; colour always follows the same effective state as speed and statistics.
        type Piece = { flow: Flow; path: [number, number][]; fromStartM: number; fromEndM: number };
        const segmentIndex = new Map(segments.map((segment, index) => [segment.id, index]));
        const endpoint = (p: number[]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
        const junctions = new Map<string, Set<number>>();
        segments.forEach((segment, index) => {
            for (const point of [segment.coords[0], segment.coords.at(-1)!]) {
                const key = endpoint(point);
                const neighbours = junctions.get(key) ?? new Set<number>();
                neighbours.add(index); junctions.set(key, neighbours);
            }
        });
        const targetLevels = new Float32Array(flows.length);
        const junctionColourCache = new Map<string, number>();
        // Before/After flips quickly so the comparison is obvious; time-driven changes keep the slower blend.
        let lastCompareMode: "before" | "after" | null = null;
        const pathLength = (path: number[][]) => path.slice(1).reduce((sum, p, i) => sum + Math.hypot((p[0] - path[i][0]) * 80400, (p[1] - path[i][1]) * 111200), 0);
        let effectiveClosed = new Set<string>();
        let closedDirections = new Set<string>();
        let effectiveKey = "";
        let pieceKey = "";
        let pieces: Piece[] = [];
        let boldPieces: Piece[] = [];
        let plainPieces: Piece[] = [];
        let visibleBoldPieces: Piece[] = [];
        let visiblePlainPieces: Piece[] = [];
        let impactViewport: number[] | null = null;
        let impactMembership = "";
        let membershipKey = "";
        const displayLevel = new Map<number, number>();
        let highlighted = new Set<number>();
        let dim = 0;
        const colourTweens = new Map<number, VisualTween>();
        const emphasisTweens = new Map<number, VisualTween>();
        const visualLevels = new Map<number, number>();
        const visualEmphasis = new Map<number, number>();
        let visualVersion = 0;
        let visualMoving = false;
        const rebuildPieces = (ids: string[]) => {
            pieces = [];
            for (const id of ids) {
                const index = segmentIndex.get(id);
                if (index === undefined || effectiveClosed.has(id)) continue;
                for (const flow of flowsBySegment[index]) {
                    if (closedDirections.has(`${segments[index].id}:${flow.direction}`)) continue;
                    const total = pathLength(flow.path);
                    let travelled = 0;
                    for (const path of splitPath(flow.path, latestRef.current.plan?.simulation ? 8 : WAVE_PIECE_M)) {
                        const length = pathLength(path);
                        const centre = travelled + length / 2;
                        pieces.push({ flow, path, fromStartM: centre, fromEndM: total - centre });
                        travelled += length;
                    }
                }
            }
        };
        const refreshState = () => {
            const { minutes, day, date } = clockRef.current;
            const { closureKey, items: scenarioItems, impacts: planImpacts, compare: mode, weather } = latestRef.current;
            const strengths = scenarioItems.map((item) => mode === "before" ? 0 : disruptionStrength(item, placedAtRef.current.get(item.id) ?? minutes, minutes, date));
            const activity = { minutes, date, suppressedVenues: suppressedVenues(scenarioItems.filter((_, i) => strengths[i] > 0)) };
            const activeKey = `${date}|${closureKey}|${mode}|${weather.rainMmPerHour},${weather.snowCmPerHour}|${scenarioItems.map((item, i) => strengths[i] > 0 ? item.id : "").join(",")}`;
            if (day === stateDay && Math.abs(minutes - stateMinutes) < 0.5 && stateClosures === activeKey)
                return;
            stateMinutes = minutes;
            stateDay = day;
            stateClosures = activeKey;
            const effective = comparisonImpacts(latestRef.current.plan, scenarioItems, placedAtRef.current, minutes, mode, date);
            effectiveClosed = effective.closed;
            closedDirections = new Set(Object.entries(effective.impacts).flatMap(([id, impact]) => impact.statesByDirection?.flatMap((state, i) => state?.capacity === 0 ? [`${id}:${i === 0 ? 1 : -1}`] : []) ?? []));
            effectiveKey = [...effectiveClosed, ...closedDirections].sort().join(",");

            // The affected area is drawn (bold, in normal colours) even before the disruption starts or in "Before" mode,
            // so comparing only changes colour, never width.
            const areaImpacts = planImpacts ?? {};
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
            // Use the effective buildup state for every displayed congestion colour.
            const affectedIds = Object.keys(areaImpacts);
            const drawIds = new Set(affectedIds);
            for (const id of affectedIds) {
                const index = segmentIndex.get(id);
                if (index === undefined) continue;
                for (const p of [segments[index].coords[0], segments[index].coords.at(-1)!]) {
                    for (const neighbour of junctions.get(endpoint(p)) ?? []) drawIds.add(segments[neighbour].id);
                }
            }
            const ids = [...drawIds];
            const nextPieceKey = `${ids.sort().join(",")}|${effectiveKey}`;
            const scenarioChanged = nextPieceKey !== pieceKey;
            if (scenarioChanged) {
                pieceKey = nextPieceKey;
                rebuildPieces(ids);
                highlighted = new Set();
            }

            displayLevel.clear();
            // Highlights only grow within a scenario, so a road does not flick between bold and thin as the clock moves.
            const nextHighlights = new Set(highlighted);
            for (const id of ids) {
                const index = segmentIndex.get(id);
                if (index === undefined) continue;
                const baseline = directionState(segments[index], share, day, weather, activity);
                for (const flow of flowsBySegment[index]) {
                    const full = impactedState(segments[index], share, day, areaImpacts[id], weather, activity, flow.direction);
                    // Affected roads show one whole level along their full length; the change still blends over time.
                    displayLevel.set(flow.index, discreteLevel(targetLevels[flow.index]));
                    if (full.level !== baseline.level || full.ratio - baseline.ratio > 0.08 || (areaImpacts[id]?.capacityScale ?? 1) < 1) nextHighlights.add(index);
                }
            }
            highlighted = nextHighlights;
            const currentIndices = new Set(ids.map(id => segmentIndex.get(id)));
            for (const index of emphasisTweens.keys()) if (!currentIndices.has(index)) {
                emphasisTweens.delete(index);
                visualEmphasis.delete(index);
            }
            for (const index of colourTweens.keys()) if (!currentIndices.has(flows[index].segment)) {
                colourTweens.delete(index);
                visualLevels.delete(index);
            }
            const now = performance.now();
            const comparing = lastCompareMode !== null && lastCompareMode !== mode;
            lastCompareMode = mode;
            const colourDuration = preference.matches ? 0 : comparing ? COMPARE_TRANSITION_MS : COLOUR_TRANSITION_MS;
            for (const id of ids) {
                const index = segmentIndex.get(id);
                if (index === undefined) continue;
                const baseline = discreteLevel(congestionForState(directionState(segments[index], share, day, weather, activity)));
                for (const flow of flowsBySegment[index]) colourTweens.set(flow.index, retargetTween(colourTweens.get(flow.index), displayLevel.get(flow.index) ?? baseline, now, colourDuration, baseline));
                emphasisTweens.set(index, retargetTween(emphasisTweens.get(index), highlighted.has(index) ? 1 : 0, now, preference.matches ? 0 : HIGHLIGHT_TRANSITION_MS, 0));
            }
            const nextMembershipKey = `${pieceKey}|${[...highlighted].sort((a, b) => a - b).join(",")}`;
            if (membershipKey !== nextMembershipKey) {
                membershipKey = nextMembershipKey;
                boldPieces = pieces.filter((piece) => highlighted.has(piece.flow.segment));
                plainPieces = pieces.filter((piece) => !highlighted.has(piece.flow.segment));
            }
        };
        /** Highlighting changes emphasis, never the calculated congestion category. */
        const pieceColor = (piece: Piece, alpha: number): [number, number, number, number] => {
            const index = piece.flow.segment;
            const to = visualLevels.get(piece.flow.index) ?? displayLevel.get(piece.flow.index) ?? 0;
            // Each affected road is one colour end to end; blending into neighbours at junctions left short
            // blocks mostly the neighbours' colour.
            const level = to;
            const emphasis = visualEmphasis.get(index) ?? 0;
            const normal = congestionColor(level), vivid = congestionColor(level, true);
            const [r, g, b] = normal.map((channel, i) => channel + (vivid[i] - channel) * emphasis);
            return [r, g, b, alpha * (highlighted.has(index) ? visualEmphasis.get(index) ?? 0 : 1)];
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
                clockRef.current = advanceClock(clockRef.current, seconds);
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
                const flowLayer = (id: string, layerData: Flow[], opacity: number) => new FlowPathLayer<Flow>({
                    id, ...placement, visible: opacity > 0, opacity, parameters: depth, data: layerData,
                    getPath: (flow) => flow.path,
                    getColor: (flow) => { const offset = flow.index * 4; return [flowColors[offset], flowColors[offset + 1], flowColors[offset + 2], flowColors[offset + 3]]; },
                    getWidth: (flow) => flow.width,
                    getOffset: (flow) => flow.twoWay ? -0.6 : 0,
                    getFlowParams: (flow) => [flowSpeeds[flow.index], flowPhases[flow.index]],
                    time: animationTime, pulseSpacing: PULSE_SPACING, widthUnits: "pixels", widthScale, widthMinPixels: 1.1, widthMaxPixels: 8, capRounded: true, jointRounded: true, antialiasing: true,
                    pickable: !latestRef.current.interacting && opacity > 0.2, autoHighlight: !latestRef.current.interacting, highlightColor: [224, 243, 255, 45], extensions: [OFFSET_EXTENSION],
                    transitions: { getColor: preference.matches ? 0 : 650 },
                    updateTriggers: { getColor: colorVersion, getFlowParams: paramVersion },
                });

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
                junctionColourCache.clear();
                const emphasis = highlighted.size && pieces.length ? 1 : 0;
                dim += (emphasis - dim) * Math.min(1, seconds * 4);
                const rest = 1 - DIM_STRENGTH * dim;
                layers.push(flowLayer("traffic-flow-local", localFlows, localOpacity * rest), flowLayer("traffic-flow-collectors", collectorFlows, collectorOpacity * rest), flowLayer("traffic-flow", mainFlows, rest));
                const boldWidth = (piece: Piece) => piece.flow.width + (Math.max(piece.flow.width, HIGHLIGHT_MIN_BASE) * HIGHLIGHT_WIDTH - piece.flow.width) * (visualEmphasis.get(piece.flow.segment) ?? 0);
                const impactLayer = (id: string, data: Piece[], bold: boolean) => new FlowPathLayer<Piece>({
                    id, ...placement, parameters: depth, data,
                    getPath: (piece) => piece.path,
                    getColor: (piece) => pieceColor(piece, 255),
                    getWidth: (piece) => bold ? boldWidth(piece) : piece.flow.width,
                    // Keep each direction centred where the normal ribbon is, whatever the drawn width.
                    getOffset: (piece) => piece.flow.twoWay ? -0.6 * piece.flow.width / (bold ? boldWidth(piece) : piece.flow.width) : 0,
                    getFlowParams: (piece) => [flowSpeeds[piece.flow.index], flowPhases[piece.flow.index]],
                    time: animationTime, pulseSpacing: PULSE_SPACING, widthUnits: "pixels", widthScale,
                    widthMinPixels: 1.1, widthMaxPixels: bold ? 12 : 8, capRounded: false, jointRounded: true, antialiasing: true,
                    pickable: false, extensions: [OFFSET_EXTENSION],
                    updateTriggers: { getColor: visualVersion, getFlowParams: paramVersion, getWidth: visualVersion, getOffset: visualVersion },
                });
                if (impactViewport !== visibleSegments || impactMembership !== membershipKey) {
                    impactViewport = visibleSegments;
                    impactMembership = membershipKey;
                    const visible = new Set(visibleSegments ?? []);
                    visiblePlainPieces = plainPieces.filter(piece => visible.has(piece.flow.segment));
                    visibleBoldPieces = boldPieces.filter(piece => visible.has(piece.flow.segment));
                }
                if (visiblePlainPieces.length) layers.push(impactLayer("traffic-flow-impact", visiblePlainPieces, false));
                if (visibleBoldPieces.length) layers.push(impactLayer("traffic-flow-highlight", visibleBoldPieces, true));
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
                if (!visualMoving && (preference.matches || !clockRef.current.playing) && Math.abs(dim - (highlighted.size && pieces.length ? 1 : 0)) < 0.01)
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
    }, [data, map, renderer, retry, buildingFade, setPanel]);
    const updateClock = (change: Partial<ClockState>) => {
        clockRef.current = { ...clockRef.current, ...change };
        setSnapshot((previous) => ({ ...previous, clock: clockRef.current }));
        redrawRef.current();
    };
    const selectedSegment = data && selected !== null && !interacting && panel === "road" ? data.segments[selected] : null;
    return (<div className="traffic-ui" data-interacting={interacting}>
      {data ? <TrafficControls clock={snapshot.clock} profile={data.profiles[snapshot.clock.day]} vehicles={snapshot.vehicles} closures={displayed.closed.size} onChange={updateClock} scenario={items.length || rerouting.plan ? { text: [compare === "before" ? "Showing before disruptions" : !rerouting.plan?.simulation && strengths.every((value) => value === 0) && nextStart !== null ? `Disruptions start ${nextStart >= 1440 ? `${shiftSimulationDate(snapshot.clock.date, Math.floor(nextStart / 1440))} at ` : "at "}${formatClock(nextStart)}` : rerouting.plan?.simulation && strengths.every(value => value === 0) && rerouting.plan.simulation.ledger.onNetwork > rerouting.plan.simulation.baselineLedger.onNetwork + 1 ? "Queues clearing" : !rerouting.plan?.simulation && Math.max(...strengths) < 1 ? "Effects building up" : null, rerouting.loading ? "Simulating traffic…" : rerouting.error ?? (rerouting.plan?.warning ? "Local diversion estimate (Gemini unavailable)" : rerouting.plan?.source === "solver" ? "Dynamic traffic estimate" : "Local diversion estimate")].filter(Boolean).join(" · "), retry: rerouting.error || rerouting.plan?.warning ? rerouting.retry : undefined, compare, onCompare: setCompare } : null} /> : null}
      {selectedSegment && data ? <RoadPanel key={selectedSegment.id} activity={{ minutes: snapshot.clock.minutes, date: snapshot.clock.date, suppressedVenues: compare === "after" ? suppressedVenues(items.filter((_, i) => strengths[i] > 0)) : [] }} weather={weather} segment={selectedSegment} data={data} clock={snapshot.clock} impact={displayed.impacts[selectedSegment.id]} closed={displayed.closed.has(selectedSegment.id)} onClose={() => { setSelected(null); setPanel(null); }}/> : null}
      {!data && !error ? <WorkspaceNotice><p className="traffic-status" role="status">Loading typical traffic…</p></WorkspaceNotice> : null}
      {error ? <WorkspaceNotice><p className="traffic-status traffic-status-error" role="alert">{error} <button type="button" onClick={() => { setError(null); setRetry((value) => value + 1); }}>Retry</button></p></WorkspaceNotice> : null}
    </div>);
}
