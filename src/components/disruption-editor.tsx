"use client";

import { useEffect, useRef } from "react";
import type { Disruption } from "@/lib/disruptions";
import { disruptionTool } from "@/lib/disruptions";
import type { Road } from "@/lib/types";
import DisruptionIcon from "./disruption-icon";

export default function DisruptionEditor({ draft, road, existing, error, onChange, onSave, onCancel, onRemove }: {
  draft: Disruption;
  road?: Road;
  existing: boolean;
  error: string;
  onChange: (item: Disruption) => void;
  onSave: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const previewRef = useRef<HTMLElement>(null);
  const tool = disruptionTool(draft.kind);
  useEffect(() => { previewRef.current?.focus({ preventScroll: true }); }, [draft.id]);

  return (
    <section ref={previewRef} className="closure-preview disruption-editor" aria-labelledby="disruption-preview-title" tabIndex={-1} data-map-ui data-kind={draft.kind}>
      <div className="closure-preview-heading">
        <span className="closure-tool-icon"><DisruptionIcon kind={draft.kind} /></span>
        <div><span className="toolbox-eyebrow">{existing ? "EDIT SCENARIO" : "PLACEMENT PREVIEW"}</span><h2 id="disruption-preview-title">{tool.label}</h2></div>
        <button className="toolbox-close" type="button" aria-label="Dismiss preview" onClick={onCancel}><DisruptionIcon kind="close" /></button>
      </div>
      <p className="disruption-location">{road ? `${road.properties.name} · ${road.properties.lengthM.toLocaleString()} m segment` : `${draft.position[1].toFixed(5)}, ${draft.position[0].toFixed(5)} · Toronto`}</p>
      {road ? <p className="closure-direction">{road.properties.direction}</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); onSave(); }}>
        <label className="disruption-field">Name<input required maxLength={80} value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} /></label>
        {draft.kind === "event" ? <label className="disruption-field">Expected attendance <span className="disruption-optional">Optional estimate</span><input type="number" min="0" max="1000000" step="1" inputMode="numeric" placeholder="Not specified" value={draft.attendance ?? ""} onChange={(event) => onChange({ ...draft, attendance: event.target.value === "" ? null : event.target.valueAsNumber })} /></label> : (
          <label className="disruption-field">Road restriction<select value={draft.restriction} onChange={(event) => onChange({ ...draft, restriction: event.target.value as "full-closure" | "lane-reduction" })}><option value="full-closure">Full closure</option><option value="lane-reduction">Lane reduction</option></select></label>
        )}
        <fieldset className="disruption-schedule"><legend>Schedule <span className="disruption-optional">Optional · Toronto time</span></legend>
          <label className="disruption-field">Starts<input type="datetime-local" value={draft.startsAt} onChange={(event) => onChange({ ...draft, startsAt: event.target.value })} /></label>
          <label className="disruption-field">Ends<input type="datetime-local" min={draft.startsAt || undefined} value={draft.endsAt} onChange={(event) => onChange({ ...draft, endsAt: event.target.value })} /></label>
        </fieldset>
        <p className="disruption-schedule-note">Schedules are recorded for planning. Disruptions apply at every playback time. Diversions and event traffic are estimated after saving.</p>
        {error ? <p className="disruption-form-error" role="alert">{error}</p> : null}
        <div className="closure-preview-actions">
          {existing ? <button className="closure-remove" type="button" onClick={onRemove}>Remove</button> : <button type="button" onClick={onCancel}>Cancel</button>}
          <button className="closure-apply" type="submit">{existing ? "Save changes" : `Add ${draft.kind === "closure" ? "closure" : draft.kind}`}</button>
        </div>
      </form>
    </section>
  );
}
