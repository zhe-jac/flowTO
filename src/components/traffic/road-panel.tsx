"use client";
import type { ClockState } from "@/lib/traffic/clock";
import { LEVEL_COLORS } from "@/lib/traffic/colors";
import { directionState, formatClock, LEVELS, MINUTES_PER_DAY, profileShare, travelDirection } from "@/lib/traffic/model";
import { CLASS_ASSUMPTIONS, type TrafficData, type TrafficSegment } from "@/lib/traffic/types";
import GlassSurface from "../glass-surface";
const CHART_W = 260;
const CHART_H = 64;
function sourceText(segment: TrafficSegment) {
    const source = segment.source;
    const year = (date?: string) => (date ? ` (${date.slice(0, 10)})` : "");
    switch (source.kind) {
        case "midblock":
            return `Measured by a City midblock count at ${source.label}${year(source.date)}.`;
        case "intersection":
            return `Estimated from a City intersection count at ${source.label}${year(source.date)}.`;
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
export default function RoadPanel({ segment, data, clock, closed, onClose }: {
    segment: TrafficSegment;
    data: TrafficData;
    clock: ClockState;
    closed: boolean;
    onClose: () => void;
}) {
    const profile = data.profiles[clock.day];
    const share = profileShare(profile, clock.minutes);
    const state = directionState(segment, share, clock.day);
    const level = LEVELS.find((item) => item.id === state.level)!;
    const assumption = CLASS_ASSUMPTIONS[segment.cls];
    const daily = clock.day === "weekday" ? segment.weekdayDaily : segment.weekendDaily;
    const labels = directions(segment);
    const ratios = profile.map((value) => directionState(segment, value, clock.day).ratio);
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
      {closed ? <p className="road-panel-note">Closed in this scenario. Figures below describe typical baseline traffic; rerouting has not been calculated.</p> : null}

      <p className="road-panel-level" style={{ borderColor: LEVEL_COLORS[state.level].css }}>
        <i style={{ background: LEVEL_COLORS[state.level].css }} aria-hidden="true"/>
        <strong>{level.label}</strong>
        <span>at {formatClock(clock.minutes)}, typical {clock.day}</span>
      </p>

      <dl className="road-panel-stats">
        <div><dt>Vehicles / hour</dt><dd>{Math.round(state.flow).toLocaleString()}<small>{labels.length > 1 ? " each way" : ` ${labels[0].toLowerCase()}`}</small></dd></div>
        <div><dt>Road capacity used</dt><dd>{Math.round(state.ratio * 100)}%</dd></div>
        <div><dt>Estimated speed</dt><dd>{Math.round(state.speedKmh)}<small> km/h</small></dd></div>
        <div><dt>Vehicles / day</dt><dd>{daily.toLocaleString()}<small> total</small></dd></div>
      </dl>
      {labels.length > 1 ? <p className="road-panel-note">{labels.join(" and ")} traffic are assumed to split evenly.</p> : null}

      <figure className="road-panel-chart">
        <figcaption>Capacity used through a typical {clock.day}</figcaption>
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
        Assumes {Math.round(state.capacity).toLocaleString()} vehicles/hour capacity per direction and {assumption?.freeSpeedKmh} km/h when uncongested.
      </p>
    </aside></GlassSurface></div>);
}
