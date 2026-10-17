"use client";

import { useState } from "react";
import { LEVEL_COLORS } from "@/lib/traffic/colors";
import { LEVELS } from "@/lib/traffic/model";
import type { TrafficData } from "@/lib/traffic/types";

export default function TrafficLegend({ meta }: { meta: TrafficData["meta"] }) {
  const [open, setOpen] = useState(false);
  const counted = meta.sourceCounts.midblock + meta.sourceCounts.intersection;
  const total = counted + meta.sourceCounts.street + meta.sourceCounts.class;

  return (
    <aside className="traffic-legend" aria-label="Traffic legend">
      <h2>Traffic flow <span>estimated</span></h2>
      <ul>
        {LEVELS.map((level) => (
          <li key={level.id}>
            <i style={{ background: LEVEL_COLORS[level.id].css }} aria-hidden="true" />
            {level.label}
          </li>
        ))}
      </ul>
      <p>White streaks flow the way traffic travels, faster where it moves faster. Click a road for details.</p>
      <button type="button" className="traffic-link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide" : "How this is estimated"}
      </button>
      {open ? (
        <div className="traffic-method">
          <p>
            Daily volumes come from City of Toronto traffic counts: {counted.toLocaleString()} of {total.toLocaleString()} road segments
            have a nearby midblock or intersection count, {meta.sourceCounts.street.toLocaleString()} borrow a count from the same street,
            and {meta.sourceCounts.class.toLocaleString()} use the typical value for their road type.
          </p>
          <p>
            The time-of-day pattern comes from {meta.profileDays.weekday} weekday and {meta.profileDays.weekend} weekend 24-hour counts.
            Congestion compares estimated hourly volume with an assumed road capacity; speeds use the BPR formula from transportation planning.
            Colours are estimates, not live sensor readings.
          </p>
          <ul className="traffic-sources">
            {meta.sources.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}</a></li>)}
          </ul>
          <p className="traffic-licence">{meta.licence}</p>
        </div>
      ) : null}
    </aside>
  );
}
