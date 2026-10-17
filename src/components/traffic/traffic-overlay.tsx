"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer, PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { PathLayer } from "@deck.gl/layers";
import type { Map as MapboxMap } from "mapbox-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Disruption } from "@/lib/disruptions";
import type { DisruptionMap } from "@/lib/disruption-map";
import { advanceClock, CLOCK_RATES, torontoNow, type ClockState } from "@/lib/traffic/clock";
import { CLASS_WIDTHS, LEVEL_COLORS } from "@/lib/traffic/colors";
import { closedRoadIds } from "@/lib/traffic/disruptions";
import { continuousPulseOffset, PULSE_SPACING } from "@/lib/traffic/flow-motion";
import { directionState, profileShare, vehiclesOnRoad } from "@/lib/traffic/model";
import type { TrafficData, TrafficSegment } from "@/lib/traffic/types";
import { FlowPathLayer } from "./flow-path-layer";
import RoadPanel from "./road-panel";
import TrafficControls from "./traffic-controls";
const FLAT_DEPTH = { depthCompare: "always", depthWriteEnabled: false } as const;
const TILTED_DEPTH = { depthCompare: "less-equal", depthWriteEnabled: false } as const;
const OFFSET_EXTENSION = new PathStyleExtension({ offset: true });
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
type TrafficMap = DisruptionMap & Pick<MapboxMap | MapLibreMap, "addControl" | "removeControl">;
type Props = {
    map: TrafficMap;
    renderer: "mapbox" | "maplibre";
    items: Disruption[];
    interacting: boolean;
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
function initialClock(): ClockState {
    const clock: ClockState = { ...torontoNow(), playing: true, rate: CLOCK_RATES[0] };
    const params = new URLSearchParams(window.location.search);
    const time = params.get("time")?.match(/^(\d{1,2}):(\d{2})$/);
    if (time && Number(time[1]) < 24 && Number(time[2]) < 60)
        clock.minutes = Number(time[1]) * 60 + Number(time[2]);
    const day = params.get("day");
    if (day === "weekday" || day === "weekend")
        clock.day = day;
    const rate = CLOCK_RATES.find((item) => item.id === params.get("speed"));
    if (rate)
        clock.rate = rate;
    if (clock.rate.id === "live" && (time || day))
        clock.rate = CLOCK_RATES[1];
    return clock;
}
export default function TrafficOverlay({ map, renderer, items, interacting }: Props) {
    const [data, setData] = useState<TrafficData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [selected, setSelected] = useState<number | null>(null);
    const [snapshot, setSnapshot] = useState<Snapshot>(() => ({ clock: initialClock(), vehicles: 0 }));
    const clockRef = useRef(snapshot.clock);
    const selectedRef = useRef<number | null>(null);
    const redrawRef = useRef<() => void>(() => { });
    const closed = useMemo(() => closedRoadIds(items), [items]);
    const closureKey = [...closed].sort().join(",");
    const latestRef = useRef({ closed, closureKey, interacting });
    useEffect(() => {
        latestRef.current = { closed, closureKey, interacting };
        if (interacting) {
            selectedRef.current = null;
            setSelected(null);
        }
        redrawRef.current();
    }, [closed, closureKey, interacting]);
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
        let mainFlows = flows.filter((flow) => !flow.local && !flow.collector);
        let collectorFlows = flows.filter((flow) => flow.collector);
        let localFlows = flows.filter((flow) => flow.local);
        let detach = () => { };
        const refreshState = () => {
            const { minutes, day } = clockRef.current;
            const { closed, closureKey } = latestRef.current;
            if (day === stateDay && Math.abs(minutes - stateMinutes) < 0.5 && stateClosures === closureKey)
                return;
            if (stateClosures !== closureKey) {
                mainFlows = flows.filter((flow) => !flow.local && !flow.collector && !closed.has(segments[flow.segment].id));
                collectorFlows = flows.filter((flow) => flow.collector && !closed.has(segments[flow.segment].id));
                localFlows = flows.filter((flow) => flow.local && !closed.has(segments[flow.segment].id));
            }
            stateMinutes = minutes;
            stateDay = day;
            stateClosures = closureKey;
            const share = profileShare(data.profiles[day], minutes);
            const states = segments.map((segment) => directionState(segment, share, day));
            vehicles = segments.reduce((sum, segment) => sum + (closed.has(segment.id) ? 0 : vehiclesOnRoad(segment, share, day)), 0);
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
                const depth = map.getPitch() >= 5 ? TILTED_DEPTH : FLAT_DEPTH;
                const widthScale = Math.min(1.25, Math.max(0.28, 2 ** ((zoom - 15.5) * 0.5)));
                const collectorOpacity = Math.max(0, Math.min(1, (zoom - 12.8) / 1.0));
                const localOpacity = Math.max(0, Math.min(1, (zoom - 14.2) / 1.0));
                const layers: Layer[] = [];
                const chosen = selectedRef.current;
                if (chosen !== null && segments[chosen] && !latestRef.current.closed.has(segments[chosen].id))
                    layers.push(new PathLayer<Flow>({ id: "traffic-selected", ...placement, parameters: depth, data: flows.filter((flow) => flow.segment === chosen), getPath: (flow) => flow.path, getColor: [79, 139, 177, 90], getWidth: (flow) => flow.width * (flow.twoWay ? 2.3 : 1) + 4, widthUnits: "pixels", widthScale, capRounded: true, jointRounded: true, antialiasing: true }));
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
                layers.push(flowLayer("traffic-flow-local", localFlows, localOpacity), flowLayer("traffic-flow-collectors", collectorFlows, collectorOpacity), flowLayer("traffic-flow", mainFlows, 1));
                overlay.setProps({ layers });
                if (now - lastUi >= 250) {
                    lastUi = now;
                    const clock = clockRef.current;
                    setSnapshot((previous) => Math.floor(previous.clock.minutes) === Math.floor(clock.minutes) && previous.clock.day === clock.day && previous.clock.playing === clock.playing && previous.clock.rate.id === clock.rate.id && Math.round(previous.vehicles) === Math.round(vehicles) ? previous : { clock, vehicles });
                }
                if (preference.matches || !clockRef.current.playing)
                    timer = window.setTimeout(() => tick(performance.now()), 250);
                else
                    frame = requestAnimationFrame(tick);
            };
            const redraw = () => {
                cancelAnimationFrame(frame);
                clearTimeout(timer);
                lastState = -Infinity;
                lastUi = -Infinity;
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
      {data ? <TrafficControls clock={snapshot.clock} profile={data.profiles[snapshot.clock.day]} vehicles={snapshot.vehicles} closures={closed.size} onChange={updateClock}/> : null}
      {selectedSegment && data ? <RoadPanel segment={selectedSegment} data={data} clock={snapshot.clock} closed={closed.has(selectedSegment.id)} onClose={() => setSelected(null)}/> : null}
      {!data && !error ? <p className="traffic-status" role="status">Loading typical traffic…</p> : null}
      {error ? <p className="traffic-status traffic-status-error" role="alert">{error} <button type="button" onClick={() => { setError(null); setRetry((value) => value + 1); }}>Retry</button></p> : null}
    </div>);
}
