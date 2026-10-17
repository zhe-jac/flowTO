"use client";
import type { WeatherRates } from "@/lib/weather";
import { weatherFactors, WEATHER_TRAFFIC_SOURCE } from "@/lib/traffic/weather";
import type { ClockState } from "@/lib/traffic/clock";
import { congestionColor } from "@/lib/traffic/colors";
import { congestionPosition, directionState, formatClock, LEVELS, MINUTES_PER_DAY, profileShare, travelDirection } from "@/lib/traffic/model";
import { CLASS_ASSUMPTIONS, type TrafficData, type TrafficSegment } from "@/lib/traffic/types";
import GlassSurface from "../glass-surface";
import { impactedState, type Impact } from "@/lib/traffic/rerouting";
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
            return `No count nearby. Uses the typical volume for ${(CLASS_ASSUMPTIONS[segment.cls]?.label ?? segment.cls).toLowerCase()} roads${source.samples ? ` across ${source.samples.toLocaleString()} City counts` : ""}.`;
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
export default function RoadPanel({ segment, data, clock, closed, impact, weather, onClose }: {
    segment: TrafficSegment;
    data: TrafficData;
    clock: ClockState;
    closed: boolean;
    impact?: Impact;
    weather: WeatherRates;
    onClose: () => void;
}) {
    const profile = data.profiles[clock.day];
    const share = profileShare(profile, clock.minutes);
    const state = impactedState(segment, share, clock.day, impact, weather);
    const factors = weatherFactors(segment.cls, weather);
    const weatherActive = factors.speed < 1 || factors.capacity < 1;
    const level = LEVELS.find((item) => item.id === state.level)!;
    const color = `rgb(${congestionColor(congestionPosition(state.ratio)).join(",")})`;
    const assumption = CLASS_ASSUMPTIONS[segment.cls];
    const daily = clock.day === "weekday" ? segment.weekdayDaily : segment.weekendDaily;
    const labels = directions(segment);
    const ratios = profile.map((value) => directionState(segment, value, clock.day, weather).ratio);
    const maxRatio = Math.max(1.1, ...ratios);
    const y = (ratio: number) => CHART_H - (ratio / maxRatio) * (CHART_H - 4);
    const line = ratios.map((ratio, index) => `${((index + 0.5) / ratios.length) * CHART_W},${y(ratio)}`).join(" L");
    const nowX = (clock.minutes / MINUTES_PER_DAY) * CHART_W;
    return (<div className="road-panel-shell" data-map-ui><GlassSurface variant="panel"><aside className="road-panel" aria-label={`${segment.name} traffic`}>
      <header>
        <div>
          <h2>{segment.name}</h2>
          <p>{assumption?.label ?? segment.cls} · {segment.lengthM.toLocaleString()} m · {segment.oneway === 0 ? "two-way" : "one-way"}</p>
        </div>
        <button type="button" className="road-panel-close" aria-label="Close road details" onClick={onClose}>×</button>
      </header>
      {closed ? <p className="road-panel-note">Closed in this scenario. Traffic is diverted to connected roads where a detour is available.</p> : null}

      <p className="road-panel-level" style={{ borderColor: color }}>
        <i style={{ background: color }} aria-hidden="true"/>
        <strong>{closed ? "Closed" : level.label}</strong>
        <span>at {formatClock(clock.minutes)}, {impact ? "scenario" : "typical"} {clock.day}</span>
      </p>

      <dl className="road-panel-stats">
        <div><dt>Vehicles / hour</dt><dd>{Math.round(state.flow).toLocaleString()}<small>{labels.length > 1 ? " each way" : ` ${labels[0].toLowerCase()}`}</small></dd></div>
        <div><dt>Road capacity used</dt><dd>{Math.round(state.ratio * 100)}%</dd></div>
        <div><dt>Estimated speed</dt><dd>{Math.round(state.speedKmh)}<small> km/h</small></dd></div>
        <div><dt>Baseline vehicles / day</dt><dd>{daily.toLocaleString()}<small> total</small></dd></div>
      </dl>
      {impact ? <p className="road-panel-note">Scenario estimate includes diverted traffic and reduced capacity. The daily chart excludes disruptions and uses the same weather.</p> : null}
      {labels.length > 1 ? <p className="road-panel-note">{labels.join(" and ")} traffic are assumed to split evenly.</p> : null}

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
      <p className="road-panel-source">
        Assumes {Math.round(state.capacity).toLocaleString()} vehicles/hour capacity per direction and {Math.round(state.freeSpeedKmh)} km/h when uncongested.
      </p>
      {weatherActive ? <p className="road-panel-source">Weather lowers assumed uncongested speed by {Math.round((1 - factors.speed) * 100)}% and capacity by {Math.round((1 - factors.capacity) * 100)}%. Demand stays unchanged. <a href={WEATHER_TRAFFIC_SOURCE} target="_blank" rel="noreferrer">Research-informed estimate</a>; not calibrated to Toronto weather.</p> : null}
    </aside></GlassSurface></div>);
}
