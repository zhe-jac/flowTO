"use client";
import { useState } from "react";
import { LEVEL_COLORS } from "@/lib/traffic/colors";
import { LEVELS } from "@/lib/traffic/model";
import type { TrafficData } from "@/lib/traffic/types";
import GlassSurface from "../glass-surface";
export default function TrafficLegend({ meta }: {
    meta: TrafficData["meta"];
}) {
    const [expanded, setExpanded] = useState(false);
    const [method, setMethod] = useState(false);
    const counted = meta.sourceCounts.midblock + meta.sourceCounts.intersection;
    const total = counted + meta.sourceCounts.street + meta.sourceCounts.class;
    return (<div className="traffic-legend-shell" data-map-ui><GlassSurface variant="panel"><aside className="traffic-legend" aria-label="Traffic legend">
      <button className="traffic-legend-toggle" type="button" aria-expanded={expanded} aria-controls="traffic-legend-details" onClick={() => setExpanded((value) => !value)}><span>Traffic flow <small>Estimated</small></span><span aria-hidden="true">{expanded ? "−" : "+"}</span></button>
      {expanded ? <div id="traffic-legend-details">
        <ul>{LEVELS.map((level) => <li key={level.id}><i style={{ background: LEVEL_COLORS[level.id].css }} aria-hidden="true"/>{level.label}</li>)}</ul>
        <p>White streaks show travel direction. Colours and speeds describe typical traffic rather than current sensor readings.</p>
        <button type="button" className="traffic-link" aria-expanded={method} onClick={() => setMethod((value) => !value)}>{method ? "Hide method" : "How this is estimated"}</button>
        {method ? <div className="traffic-method">
          <p>{counted.toLocaleString()} of {total.toLocaleString()} segments use midblock counts or estimates from nearby intersection counts; {meta.sourceCounts.street.toLocaleString()} borrow a count from the same street, and {meta.sourceCounts.class.toLocaleString()} use a road-class estimate.</p>
          <p>Daily patterns use {meta.profileDays.weekday} weekday and {meta.profileDays.weekend} weekend 24-hour count days. Capacity is assumed by road class, speeds use the BPR formula, and two-way volumes split evenly. These are approximate conditions.</p>
          <p>Saved full closures hide their road's traffic for all playback times. Schedules remain recorded metadata. Lane reductions and events do not change traffic yet; diversions and queues are not calculated.</p>
          <ul className="traffic-sources">{meta.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a></li>)}</ul>
          <p className="traffic-licence">{meta.licence}</p>
        </div> : null}
      </div> : null}
    </aside></GlassSurface></div>);
}
