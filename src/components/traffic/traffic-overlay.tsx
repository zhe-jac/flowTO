"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer } from "@deck.gl/layers";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import type { DisruptionMap } from "@/lib/disruption-map";
import { advanceClock, initialTrafficClock, type ClockState } from "@/lib/traffic/clock";
import { simulatorLight, type SimulatorLight } from "@/lib/daylight";
import { CLASS_WIDTHS, LEVEL_COLORS, VIVID_COLORS } from "@/lib/traffic/colors";
import { closedRoadIds } from "@/lib/traffic/disruptions";
import { continuousPulseOffset, PULSE_SPACING } from "@/lib/traffic/flow-motion";
import { createTrafficViewport } from "@/lib/traffic/viewport";
import { directionState, profileShare, type CongestionLevel } from "@/lib/traffic/model";
import type { DayType, TrafficData, TrafficSegment } from "@/lib/traffic/types";
import { FlowPathLayer } from "./flow-path-layer";
import RoadPanel from "./road-panel";
import TrafficControls from "./traffic-controls";
import { impactedState, type Impact } from "@/lib/traffic/rerouting";
import { disruptionStrength, disruptionWindow, scaleImpact, splitPath, waveDuration, waveLevel } from "@/lib/traffic/scenario-timing";
import { formatClock, LEVELS } from "@/lib/traffic/model";
import { useRerouting } from "./use-rerouting";
const FLAT_DEPTH = { depthCompare: "always", depthWriteEnabled: false } as const;
const TILTED_DEPTH = { depthCompare: "less-equal", depthWriteEnabled: false } as const;
const OFFSET_EXTENSION = new PathStyleExtension({ offset: true });
/**
 * The impact wave, in simulated minutes after a disruption starts: each congestion level sweeps from the disruption to
 * the far end of the affected area in `sweep` minutes, the next level `gap` minutes behind. Faster playback speeds it up.
 */
const WAVE_TIMING = { sweep: 30, gap: 12, blend: 8 };
/** Affected roads are cut into pieces this long so the colour front moves smoothly along them. */
const WAVE_PIECE_M = 20;
const HIGHLIGHT_WIDTH = 1.22;
/** Highlighted roads are drawn at least as wide as an arterial, so small streets do not stay thin. */
const HIGHLIGHT_MIN_BASE = 7;
const GLOW_WIDTH = 2.2;
const LEVEL_ORDER = LEVELS.map((level) => level.id);
/** How much unaffected roads fade while a scenario's affected roads are highlighted. */
const DIM_STRENGTH = 0.45;
type Flow = {
    index: number;
    segment: number;
    path: [
        number,
        number
    ][];
    width: number;
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
    onLightChange: (light: SimulatorLight) => void;
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
            flows.push({ index: flows.length, segment: index, path, width: CLASS_WIDTHS[segment.cls] ?? 3, twoWay: segment.oneway === 0, local: segment.cls === "Local", collector: segment.cls.startsWith("Collector") });
    });
    return flows;
}
export default function TrafficOverlay({ map, renderer, items, interacting, onLightChange }: Props) {
    const [data, setData] = useState<TrafficData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ clock: initialTrafficClock(window.location.search), vehicles: 0 }));
    const rerouting = useRerouting(items, snapshot.clock.day, snapshot.clock.minutes);
    const impacts = rerouting.plan?.impacts;
    const impactKey = JSON.stringify(impacts ?? {});
    const light = simulatorLight(snapshot.clock.minutes);
    const lightKey = `${light.phase}:${light.daylight}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lightKey captures every field of light.
    useEffect(() => { onLightChange(light); }, [lightKey, onLightChange]);
    const clockRef = useRef(snapshot.clock);
    const selectedRef = useRef<number | null>(null);
    const redrawRef = useRef<() => void>(() => { });
    const closed = useMemo(() => closedRoadIds(items), [items]);
    // Typical-day time each unscheduled disruption was placed: its effect starts then and builds up afterwards.
    const placedAtRef = useRef(new Map<string, number>());
    for (const item of items) if (!placedAtRef.current.has(item.id)) placedAtRef.current.set(item.id, Math.floor(clockRef.current.minutes));
    for (const id of [...placedAtRef.current.keys()]) if (!items.some((item) => item.id === id)) placedAtRef.current.delete(id);
    const [compare, setCompare] = useState<"before" | "after">("after");
    const compareRef = useRef(compare);
    compareRef.current = compare;
    const strengths = items.map((item) => disruptionStrength(item, placedAtRef.current.get(item.id) ?? snapshot.clock.minutes, snapshot.clock.minutes));
    const nextStart = items.map((item, i) => strengths[i] > 0 ? null : disruptionWindow(item, placedAtRef.current.get(item.id) ?? 0).start).find((start) => start !== null) ?? null;
    const closureKey = [...closed].sort().join(",") + impactKey;
    const latestRef = useRef({ closed, closureKey, interacting, impacts, items, compare });
    useEffect(() => {
        latestRef.current = { closed, closureKey, interacting, impacts, items, compare };
        if (interacting) {
            selectedRef.current = null;
            setSelected(null);
        }
        redrawRef.current();
    }, [closed, closureKey, interacting, impacts, items, compare]);
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
                setData(result);
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
        // Impact wave: affected roads change colour along their length on the simulator clock, sweeping out from the
        // disruptions one congestion level at a time, so congestion builds over simulated minutes rather than at once.
        // Roads that get meaningfully worse are highlighted while the rest of the network dims.
        type Piece = { flow: Flow; path: [number, number][]; reach: number };
        const segmentIndex = new Map(segments.map((segment, index) => [segment.id, index]));
        let effectiveClosed = new Set<string>();
        let effectiveKey = "";
        let pieceKey = "";
        let pieces: Piece[] = [];
        let scenarioStart: number | null = null;
        const baseLevel = new Map<number, number>();
        const fullLevel = new Map<number, number>();
        let highlighted = new Set<number>();
        let impactVersion = 0;
        let dim = 0;
        const metresBetween = (a: number[], b: number[]) => Math.hypot((a[0] - b[0]) * 80400, (a[1] - b[1]) * 111200);
        const minutesSinceStart = (minutes: number) => scenarioStart === null ? -1 : ((minutes - scenarioStart) % 1440 + 1440) % 1440;
        const rebuildPieces = (ids: string[]) => {
            const origins = latestRef.current.items.map((item) => item.position as number[]);
            const raw: (Piece & { distance: number })[] = [];
            for (const id of ids) {
                const index = segmentIndex.get(id);
                if (index === undefined || effectiveClosed.has(id)) continue;
                for (const flow of flowsBySegment[index]) {
                    for (const path of splitPath(flow.path, WAVE_PIECE_M)) {
                        const centre = path[Math.floor(path.length / 2)];
                        raw.push({ flow, path, reach: 0, distance: origins.length ? Math.min(...origins.map((origin) => metresBetween(centre, origin))) : 0 });
                    }
                }
            }
            const farthest = Math.max(1, ...raw.map((piece) => piece.distance));
            pieces = raw.map(({ flow, path, distance }) => ({ flow, path, reach: distance / farthest }));
        };
        const refreshState = () => {
            const { minutes, day } = clockRef.current;
            const { closureKey, items: scenarioItems, impacts: planImpacts, compare: mode } = latestRef.current;
            const strengths = scenarioItems.map((item) => mode === "before" ? 0 : disruptionStrength(item, placedAtRef.current.get(item.id) ?? minutes, minutes));
            const strength = Math.max(0, ...strengths);
            const activeKey = `${closureKey}|${mode}|${scenarioItems.map((item, i) => strengths[i] > 0 ? item.id : "").join(",")}`;
            if (day === stateDay && Math.abs(minutes - stateMinutes) < 0.5 && stateClosures === activeKey)
                return;
            stateMinutes = minutes;
            stateDay = day;
            stateClosures = activeKey;
            effectiveClosed = new Set(scenarioItems.flatMap((item, i) => strengths[i] > 0 && item.kind !== "event" && item.restriction === "full-closure" ? [item.roadId] : []));
            effectiveKey = [...effectiveClosed].sort().join(",");
            const starts = scenarioItems.flatMap((item, i) => strengths[i] > 0 ? [disruptionWindow(item, placedAtRef.current.get(item.id) ?? minutes).start] : []);
            scenarioStart = starts.length ? starts.reduce((earliest, start) => minutesSince(start, minutes) > minutesSince(earliest, minutes) ? start : earliest) : null;
            const activeImpacts = strength > 0 && planImpacts ? planImpacts : {};
            // The affected area is drawn (bold, in normal colours) even before the disruption starts or in "Before" mode,
            // so comparing only changes colour, never width.
            const areaImpacts = planImpacts ?? {};
            const impacts: Record<string, Impact> = Object.fromEntries(Object.entries(activeImpacts).map(([id, impact]) => [id, scaleImpact(impact, strength)]));
            const share = profileShare(data.profiles[day], minutes);
            const states = segments.map((segment) => impactedState(segment, share, day, impacts[segment.id]));
            vehicles = segments.reduce((sum, segment, i) => sum + (effectiveClosed.has(segment.id) ? 0 : states[i].flow / Math.max(1, states[i].speedKmh) * segment.lengthM / 1000 * (segment.oneway === 0 ? 2 : 1)), 0);
            let colorsChanged = false;
            let speedsChanged = false;
            flows.forEach((flow, index) => {
                const state = states[flow.segment];
                const [r, g, b] = LEVEL_COLORS[state.level].road;
                const alpha = flow.local ? 155 : flow.collector ? 190 : 225;
                const offset = index * 4;
                if (flowColors[offset] !== r || flowColors[offset + 1] !== g || flowColors[offset + 2] !== b || flowColors[offset + 3] !== alpha) {
                    flowColors.set([r, g, b, alpha], offset);
                    colorsChanged = true;
                }
                const speed = Math.round(Math.max(0.25, state.speedKmh / 7) * 4) / 4;
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
            // Each affected road moves from its normal level to its full-impact level as the wave passes it.
            const ids = Object.keys(areaImpacts);
            const nextPieceKey = `${ids.sort().join(",")}|${effectiveKey}`;
            const scenarioChanged = nextPieceKey !== pieceKey;
            if (scenarioChanged) {
                pieceKey = nextPieceKey;
                rebuildPieces(ids);
                highlighted = new Set();
            }
            const showChange = mode === "after" && strength > 0;
            baseLevel.clear();
            fullLevel.clear();
            // Highlights only grow within a scenario, so a road does not flick between bold and thin as the clock moves.
            const nextHighlights = new Set(highlighted);
            for (const id of ids) {
                const index = segmentIndex.get(id);
                if (index === undefined) continue;
                const baseline = directionState(segments[index], share, day);
                const full = impactedState(segments[index], share, day, areaImpacts[id]);
                baseLevel.set(index, LEVEL_ORDER.indexOf(baseline.level));
                fullLevel.set(index, showChange ? LEVEL_ORDER.indexOf(full.level) : LEVEL_ORDER.indexOf(baseline.level));
                if (full.level !== baseline.level || full.ratio - baseline.ratio > 0.08 || areaImpacts[id].capacityScale < 1) nextHighlights.add(index);
            }
            highlighted = nextHighlights;
            impactVersion++;
        };
        const minutesSince = (start: number, minutes: number) => ((minutes - start) % 1440 + 1440) % 1440;
        const levelColor = (level: number, vivid: boolean) => {
            const low = Math.max(0, Math.min(3, Math.floor(level)));
            const high = Math.min(3, low + 1);
            const t = level - low;
            const palette = (id: CongestionLevel) => vivid ? VIVID_COLORS[id] : LEVEL_COLORS[id].road;
            const a = palette(LEVEL_ORDER[low]);
            const b = palette(LEVEL_ORDER[high]);
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        };
        /** Colour of a piece `since` simulated minutes after the scenario started, vivid when its road is highlighted. */
        const pieceColor = (piece: Piece, since: number, alpha: number): [number, number, number, number] => {
            const index = piece.flow.segment;
            const from = baseLevel.get(index) ?? 0;
            const to = fullLevel.get(index) ?? from;
            const level = since < 0 ? from : waveLevel(from, to, since, piece.reach, WAVE_TIMING);
            const [r, g, b] = levelColor(level, highlighted.has(index));
            return [r, g, b, alpha];
        };
        const roadPick = (info: PickingInfo<Flow>) => {
            if (latestRef.current.interacting || map.getCanvas().parentElement?.dataset.disruptionInteraction === "true")
                return;
            if (map.getLayer("disruption-applied-line") && map.queryRenderedFeatures([[info.x - 5, info.y - 5], [info.x + 5, info.y + 5]], { layers: ["disruption-applied-line", "disruption-applied-locations"] }).length)
                return;
            setSelected(info.layer?.id.startsWith("traffic-flow") && info.object ? info.object.segment : null);
        };
        async function initialize() {
            const Overlay = renderer === "mapbox" ? (await import("@deck.gl/mapbox")).MapboxOverlay : (await import("@deck.gl/maplibre")).MapLibreOverlay;
            if (disposed)
                return;
            const overlay = new Overlay({ interleaved: true, pickingRadius: 8, onClick: roadPick, getCursor: ({ isHovering, isDragging }) => latestRef.current.interacting ? "crosshair" : isDragging ? "grabbing" : isHovering ? "pointer" : "grab", layers: [], onError: () => setError("Traffic rendering is unavailable. The map and disruption tools are still available.") });
            const placement = renderer === "mapbox" ? { slot: "middle" as const } : { beforeId: "outside-toronto-mask" };
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
                        visibleClosures = effectiveKey;
                        mainFlows = [];
                        collectorFlows = [];
                        localFlows = [];
                        for (const index of next) {
                            if (effectiveClosed.has(segments[index].id)) continue;
                            for (const flow of flowsBySegment[index]) {
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
                const since = minutesSinceStart(clockRef.current.minutes);
                const spreading = since >= 0 && since < waveDuration(3, WAVE_TIMING);
                // Colours follow the simulator clock, so they are recomputed every frame while the wave is moving.
                if (spreading && clockRef.current.playing) impactVersion++;
                const emphasis = highlighted.size && pieces.length ? 1 : 0;
                dim += (emphasis - dim) * Math.min(1, seconds * 4);
                const rest = 1 - DIM_STRENGTH * dim;
                layers.push(flowLayer("traffic-flow-local", localFlows, localOpacity * rest), flowLayer("traffic-flow-collectors", collectorFlows, collectorOpacity * rest), flowLayer("traffic-flow", mainFlows, rest));
                const boldPieces = pieces.filter((piece) => highlighted.has(piece.flow.segment));
                const plainPieces = pieces.filter((piece) => !highlighted.has(piece.flow.segment));
                const boldWidth = (piece: Piece) => Math.max(piece.flow.width, HIGHLIGHT_MIN_BASE);
                if (boldPieces.length) layers.push(new PathLayer<Piece, { getOffset?: (piece: Piece) => number }>({
                    id: "traffic-impact-glow", ...placement, parameters: depth, data: boldPieces,
                    getPath: (piece) => piece.path, getColor: (piece) => pieceColor(piece, since, 60), getWidth: (piece) => boldWidth(piece) * GLOW_WIDTH,
                    getOffset: (piece) => piece.flow.twoWay ? -0.6 * piece.flow.width / (boldWidth(piece) * GLOW_WIDTH) : 0,
                    widthUnits: "pixels", widthScale, widthMinPixels: 8, capRounded: false, jointRounded: true, extensions: [OFFSET_EXTENSION],
                    updateTriggers: { getColor: impactVersion, getWidth: pieceKey, getOffset: pieceKey },
                }));
                const impactLayer = (id: string, data: Piece[], bold: boolean) => new FlowPathLayer<Piece>({
                    id, ...placement, parameters: depth, data,
                    getPath: (piece) => piece.path,
                    getColor: (piece) => pieceColor(piece, since, 255),
                    getWidth: (piece) => bold ? boldWidth(piece) * HIGHLIGHT_WIDTH : piece.flow.width,
                    // Keep each direction centred where the normal ribbon is, whatever the drawn width.
                    getOffset: (piece) => piece.flow.twoWay ? -0.6 * piece.flow.width / (bold ? boldWidth(piece) * HIGHLIGHT_WIDTH : piece.flow.width) : 0,
                    getFlowParams: (piece) => [flowSpeeds[piece.flow.index], flowPhases[piece.flow.index]],
                    time: animationTime, pulseSpacing: PULSE_SPACING, widthUnits: "pixels", widthScale,
                    widthMinPixels: bold ? 3.5 : 1.4, widthMaxPixels: bold ? 12 : 8, capRounded: true, jointRounded: true, antialiasing: true,
                    pickable: false, extensions: [OFFSET_EXTENSION],
                    updateTriggers: { getColor: impactVersion, getFlowParams: paramVersion, getWidth: pieceKey, getOffset: pieceKey },
                });
                if (plainPieces.length) layers.push(impactLayer("traffic-flow-impact", plainPieces, false));
                if (boldPieces.length) layers.push(impactLayer("traffic-flow-highlight", boldPieces, true));
                overlay.setProps({ layers });
                if (now - lastUi >= 250) {
                    lastUi = now;
                    const clock = clockRef.current;
                    setSnapshot((previous) => Math.floor(previous.clock.minutes) === Math.floor(clock.minutes) && previous.clock.day === clock.day && previous.clock.playing === clock.playing && previous.clock.rate.id === clock.rate.id && Math.round(previous.vehicles) === Math.round(vehicles) ? previous : { clock, vehicles });
                }
                if ((preference.matches || !clockRef.current.playing) && Math.abs(dim - (highlighted.size && pieces.length ? 1 : 0)) < 0.01)
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
        return () => { disposed = true; cancelAnimationFrame(frame); clearTimeout(timer); redrawRef.current = () => { }; detach(); };
    }, [data, map, renderer, retry]);
    const updateClock = (change: Partial<ClockState>) => {
        clockRef.current = { ...clockRef.current, ...change };
        setSnapshot((previous) => ({ ...previous, clock: clockRef.current }));
        redrawRef.current();
    };
    const selectedSegment = data && selected !== null && !interacting ? data.segments[selected] : null;
    return (<div className="traffic-ui" data-interacting={interacting}>
      {data ? <TrafficControls clock={snapshot.clock} profile={data.profiles[snapshot.clock.day]} vehicles={snapshot.vehicles} closures={closed.size} onChange={updateClock} scenario={items.length ? { text: [compare === "before" ? "Showing before disruptions" : strengths.every((value) => value === 0) && nextStart !== null ? `Disruptions start at ${formatClock(nextStart)}` : Math.max(...strengths) < 1 ? "Effects building up" : null, rerouting.loading ? "Estimating diversions…" : rerouting.error ?? (rerouting.plan?.warning ? "Local diversion estimate (Gemini unavailable)" : rerouting.plan?.source === "gemini" ? "Diversions estimated with Gemini" : "Local diversion estimate")].filter(Boolean).join(" · "), retry: rerouting.error || rerouting.plan?.warning ? rerouting.retry : undefined, compare, onCompare: setCompare } : null} /> : null}
      {selectedSegment && data ? <RoadPanel segment={selectedSegment} data={data} clock={snapshot.clock} impact={impacts?.[selectedSegment.id]} closed={closed.has(selectedSegment.id)} onClose={() => setSelected(null)}/> : null}
      {!data && !error ? <p className="traffic-status" role="status">Loading typical traffic…</p> : null}
      {error ? <p className="traffic-status traffic-status-error" role="alert">{error} <button type="button" onClick={() => { setError(null); setRetry((value) => value + 1); }}>Retry</button></p> : null}
    </div>);
}
