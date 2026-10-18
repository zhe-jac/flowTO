"use client";
import type { WeatherRates } from "@/lib/weather";
import { weatherFactors, WEATHER_TRAFFIC_SOURCE } from "@/lib/traffic/weather";
import type { ClockState } from "@/lib/traffic/clock";
import { congestionColor } from "@/lib/traffic/colors";
import { congestionForState, directionState, formatClock, LEVELS, MINUTES_PER_DAY, profileShare, travelDirection } from "@/lib/traffic/model";
import { CLASS_ASSUMPTIONS, type TrafficData, type TrafficSegment } from "@/lib/traffic/types";
import { WorkspacePanel } from "../workspace-layout";
import { impactedDirectionStates, type Impact } from "@/lib/traffic/rerouting";
import type { ActivityContext } from "@/lib/traffic/activity";
const CHART_W = 260;
const CHART_H = 64;
function sourceText(segment: TrafficSegment) {
    const source = segment.source;
    const year = (date?: string) => (date ? ` (${date.slice(0, 10)})` : "");
    const adjusted = (factor?: number) => {
        if (!factor || Math.abs(factor - 1) < 0.02) return "";
        const percent = Math.round((factor - 1) * 100);
        return ` Adjusted to recent (2022+) levels: ${percent > 0 ? "+" : ""}${percent}%.`;
    };
    switch (source.kind) {
        case "midblock": {
            const latest = source.date.slice(0, 4);
            if (source.counts && source.counts > 1)
                return `Based on ${source.counts} City midblock counts at ${source.label} (${source.firstYear}–${latest}), newest weighted most.${adjusted(source.adjustment)}`;
            return `Measured by a City midblock count at ${source.label}${year(source.date)}.${adjusted(source.adjustment)}`;
        }
        case "intersection":
            return `Estimated from a City intersection count at ${source.label}${year(source.date)}.${adjusted(source.adjustment)}`;
        case "street":
            return `Estimated from a count ${source.distanceM.toLocaleString()} m along ${segment.name}${source.label ? ` at ${source.label}` : ""}${year(source.date)}.`;
        case "class":
            return `No count nearby. Uses the typical volume for ${(CLASS_ASSUMPTIONS[segment.cls]?.label ?? segment.cls).toLowerCase()} roads${source.samples ? ` across ${source.samples.toLocaleString()} City counts` : ""}${source.localDensity ? `, scaled ${Math.round((source.localDensity.factor - 1) * 100) >= 0 ? "+" : ""}${Math.round((source.localDensity.factor - 1) * 100)}% for ${source.localDensity.neighbourhood}'s population density (${source.localDensity.perKm2.toLocaleString()}/km², 2016 Census)` : ""}.`;
    }
}
function directions(segment: TrafficSegment) {
    const first = segment.coords[0];
    const last = segment.coords[segment.coords.length - 1];
    const forward = travelDirection(first, last);
    const backward = travelDirection(last, first);
    if (segment.oneway === 1)
        return [forward];
    if (segment.oneway === -1)
        return [backward];
    return [forward, backward];
}
export default function RoadPanel({ segment, data, clock, closed, impact, weather, activity, onClose }: {
    segment: TrafficSegment;
    data: TrafficData;
    clock: ClockState;
    closed: boolean;
    impact?: Impact;
    weather: WeatherRates;
    activity?: ActivityContext;
    onClose: () => void;
}) {
    const profile = data.profiles[clock.day];
    const share = profileShare(profile, clock.minutes);
    const movement = impactedDirectionStates(segment, share, clock.day, impact, weather, activity ?? { minutes: clock.minutes, date: clock.date })[0];
    const state = movement.state;
    const baselineState = impact?.baselineStatesByDirection?.[movement.direction === 1 ? 0 : 1];
    const movementLabel = travelDirection(movement.direction === 1 ? segment.coords[0] : segment.coords.at(-1)!, movement.direction === 1 ? segment.coords.at(-1)! : segment.coords[0]);
    const closedMovements = (impact?.statesByDirection ?? []).flatMap((value, i) => value?.capacity === 0 ? [travelDirection(i === 0 ? segment.coords[0] : segment.coords.at(-1)!, i === 0 ? segment.coords.at(-1)! : segment.coords[0]).toLowerCase()] : []);
    const factors = weatherFactors(segment.cls, weather);
    const weatherActive = factors.speed < 1 || factors.capacity < 1;
    const level = LEVELS.find((item) => item.id === state.level)!;
    const color = `rgb(${congestionColor(congestionForState(state)).join(",")})`;
    const assumption = CLASS_ASSUMPTIONS[segment.cls];
    const daily = clock.day === "weekday" ? segment.weekdayDaily : segment.weekendDaily;
    const labels = directions(segment);
    const ratios = profile.map((value, index) => directionState(segment, value, clock.day, weather, { ...activity, minutes: index * 15 + 7.5, date: clock.date }).ratio);
    const maxRatio = Math.max(1.1, ...ratios);
    const y = (ratio: number) => CHART_H - (ratio / maxRatio) * (CHART_H - 4);
    const line = ratios.map((ratio, index) => `${((index + 0.5) / ratios.length) * CHART_W},${y(ratio)}`).join(" L");
    const nowX = (clock.minutes / MINUTES_PER_DAY) * CHART_W;
    return (<WorkspacePanel name="road"><div className="road-panel-shell" data-map-ui><aside className="road-panel" aria-label={`${segment.name} traffic`}>
      <header>
        <div>
          <h2>{segment.name}</h2>
          <p>{assumption?.label ?? segment.cls} · {segment.lengthM.toLocaleString()} m · {segment.oneway === 0 ? "two-way" : "one-way"}</p>
        </div>
        <button type="button" className="road-panel-close" aria-label="Close road details" onClick={onClose}>×</button>
      </header>
      {closed ? <p className="road-panel-note">Closed in this scenario. Traffic is diverted to connected roads where a detour is available.</p> : null}

      {!closed && closedMovements.length ? <p className="road-panel-note">Closed {closedMovements.join(" and ")} in this scenario.</p> : null}

      <p className="road-panel-level" style={{ borderColor: color }}>
        <i style={{ background: color }} aria-hidden="true"/>
        <strong>{closed || state.capacity === 0 ? "Closed" : level.label}</strong>
        <span>at {formatClock(clock.minutes)}, {impact ? "scenario" : "typical"} {clock.day}</span>
      </p>

      <dl className="road-panel-stats">
        <div><dt>Vehicles / hour</dt><dd>{Math.round(state.flow).toLocaleString()}<small>{` ${movementLabel.toLowerCase()}${labels.length > 1 ? " · busiest" : ""}`}</small></dd></div>
        <div><dt>Throughput / capacity</dt><dd>{Math.round(state.ratio * 100)}%</dd></div>
        <div><dt>Estimated speed</dt><dd>{Math.round(state.speedKmh)}<small> km/h</small></dd></div>
        {"queueVehicles" in state ? <div><dt>Vehicles queued</dt><dd>{Math.round(Number(state.queueVehicles)).toLocaleString()}</dd></div> : null}
        {baselineState && "queueVehicles" in state ? <div><dt>Additional queue</dt><dd>{Math.round(Math.max(0, Number(state.queueVehicles) - baselineState.queueVehicles)).toLocaleString()}<small> vehicles</small></dd></div> : null}
        <div><dt>Baseline vehicles / day</dt><dd>{daily.toLocaleString()}<small> total</small></dd></div>
      </dl>
      {impact ? <p className="road-panel-note">The scenario tracks traffic, queues and recovery in a local road network. The daily chart shows historical demand.</p> : null}

      <figure className="road-panel-chart">
        <figcaption>Capacity used through a typical {clock.day}{weatherActive ? " · selected weather" : ""}</figcaption>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} role="img" aria-label={`Peaks at ${Math.round(Math.max(...ratios) * 100)}% of capacity`}>
          <line className="road-panel-capacity" x1="0" x2={CHART_W} y1={y(1)} y2={y(1)}/>
          <path className="road-panel-area" d={`M0,${CHART_H} L${line} L${CHART_W},${CHART_H} Z`}/>
          <path className="road-panel-line" d={`M${line}`}/>
          <line className="road-panel-now" x1={nowX} x2={nowX} y1="0" y2={CHART_H}/>
        </svg>
        <div className="road-panel-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>
      </figure>

      <p className="road-panel-source">{sourceText(segment)}</p>
      {daily < 100 && segment.source.kind === "intersection" ? <p className="road-panel-source">Very low historical count. Existing restrictions may already be reflected in this baseline.</p> : null}
      {weatherActive ? <p className="road-panel-source">Weather lowers assumed uncongested speed by {Math.round((1 - factors.speed) * 100)}% and capacity by {Math.round((1 - factors.capacity) * 100)}%. Demand stays unchanged. <a href={WEATHER_TRAFFIC_SOURCE} target="_blank" rel="noreferrer">Research-informed estimate</a>; not calibrated to Toronto weather.</p> : null}
    </aside></div></WorkspacePanel>);
}
