"use client";

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Disruption } from "@/lib/disruptions";
import type { SavedRun } from "@/lib/run-payload";
import { formatClock } from "@/lib/traffic/model";
import { summarizeRun, type RunPoint } from "@/lib/traffic/run-metrics";
import type { SimulationResult } from "@/lib/traffic/simulation-types";
import type { WeatherRates } from "@/lib/weather";
import DisruptionIcon from "../disruption-icon";
import GlassSurface from "../glass-surface";
import { useWorkspaceLayout, WorkspacePanel } from "../workspace-layout";

type Props = {
  run: SimulationResult | null;
  loading: boolean;
  items: Disruption[];
  date: string;
  minutes: number;
  weather: WeatherRates;
  roadNames: ReadonlyMap<string, string>;
  dataVersion: string;
  onSelectRoad: (id: string) => void;
};

const number = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const clock = (minutes: number) => formatClock(((minutes % 1440) + 1440) % 1440);

/** Two-series line chart: vehicles on the modelled roads, normal day versus the scenario, with a hover crosshair. */
function VehiclesChart({ series, now }: { series: RunPoint[]; now: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 300, height = 132, left = 34, right = 10, top = 10, bottom = 22;
  const start = series[0].minute, end = series.at(-1)!.minute;
  const max = Math.max(1, ...series.map(p => Math.max(p.baselineOnNetwork, p.scenarioOnNetwork))) * 1.08;
  const x = (minute: number) => left + ((minute - start) / Math.max(1, end - start)) * (width - left - right);
  const y = (value: number) => top + (1 - value / max) * (height - top - bottom);
  const line = (key: "baselineOnNetwork" | "scenarioOnNetwork") => series.map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const ticks = [0, max / 2, max].map(v => Math.round(v / 10) * 10);
  const point = hover === null ? null : series[hover];
  const move = (event: ReactPointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const minute = start + ((event.clientX - box.left) / box.width) * (end - start);
    let best = 0;
    series.forEach((p, i) => { if (Math.abs(p.minute - minute) < Math.abs(series[best].minute - minute)) best = i; });
    setHover(best);
  };
  const last = series.at(-1)!;
  return (
    <figure className="dashboard-chart">
      <figcaption>Vehicles on the modelled roads</figcaption>
      <div className="dashboard-legend" aria-hidden="true"><span data-series="1">Normal day</span><span data-series="2">With disruptions</span></div>
      <div className="dashboard-chart-plot">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Vehicles on the roads from ${clock(start)} to ${clock(end)}: up to ${number.format(Math.max(...series.map(p => p.scenarioOnNetwork)))} with disruptions versus ${number.format(Math.max(...series.map(p => p.baselineOnNetwork)))} normally`}>
          {ticks.map(t => <g key={t}><line className="dashboard-grid" x1={left} x2={width - right} y1={y(t)} y2={y(t)} /><text className="dashboard-axis" x={left - 4} y={y(t) + 3} textAnchor="end">{number.format(t)}</text></g>)}
          {[start, (start + end) / 2, end].map(m => <text key={m} className="dashboard-axis" x={x(m)} y={height - 6} textAnchor={m === start ? "start" : m === end ? "end" : "middle"}>{clock(m)}</text>)}
          {now >= start && now <= end ? <line className="dashboard-now" x1={x(now)} x2={x(now)} y1={top} y2={height - bottom} /> : null}
          <path className="dashboard-line" data-series="1" d={line("baselineOnNetwork")} />
          <path className="dashboard-line" data-series="2" d={line("scenarioOnNetwork")} />
          <text className="dashboard-direct" x={width - right - 2} y={y(last.scenarioOnNetwork) - 5} textAnchor="end">With disruptions</text>
          {point ? <>
            <line className="dashboard-crosshair" x1={x(point.minute)} x2={x(point.minute)} y1={top} y2={height - bottom} />
            <circle className="dashboard-dot" data-series="1" cx={x(point.minute)} cy={y(point.baselineOnNetwork)} r="4" />
            <circle className="dashboard-dot" data-series="2" cx={x(point.minute)} cy={y(point.scenarioOnNetwork)} r="4" />
          </> : null}
          <rect x={left} y={top} width={width - left - right} height={height - top - bottom} fill="transparent" onPointerMove={move} onPointerLeave={() => setHover(null)} />
        </svg>
        {point ? <div className="dashboard-tooltip" role="status" style={{ left: `${(x(point.minute) / width) * 100}%` }}>
          <strong>{clock(point.minute)}</strong>
          <span data-series="1">Normal day {number.format(point.baselineOnNetwork)}</span>
          <span data-series="2">With disruptions {number.format(point.scenarioOnNetwork)}</span>
        </div> : null}
      </div>
      <details className="dashboard-table">
        <summary>Show data</summary>
        <table>
          <thead><tr><th>Time</th><th>Normal day</th><th>With disruptions</th></tr></thead>
          <tbody>{series.filter((_, i) => i % Math.max(1, Math.ceil(series.length / 24)) === 0).map(p => <tr key={p.minute}><td>{clock(p.minute)}</td><td>{number.format(p.baselineOnNetwork)}</td><td>{number.format(p.scenarioOnNetwork)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Single-series horizontal bars with the value written beside each bar. */
function Bars({ rows, unit, onSelect, label }: { rows: { key: string; name: string; value: number; detail?: string }[]; unit: string; onSelect?: (key: string) => void; label: string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <ol className="dashboard-bars" aria-label={label}>
      {rows.map(row => {
        const content = <>
          <span className="dashboard-bar-name">{row.name}{row.detail ? <small>{row.detail}</small> : null}</span>
          <span className="dashboard-bar-track"><span className="dashboard-bar" style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} /></span>
          <span className="dashboard-bar-value">{oneDecimal.format(row.value)} {unit}</span>
        </>;
        return <li key={row.key}>{onSelect ? <button type="button" onClick={() => onSelect(row.key)}>{content}</button> : <div>{content}</div>}</li>;
      })}
    </ol>
  );
}

export default function TrafficDashboard({ run, loading, items, date, minutes, weather, roadNames, dataVersion, onSelectRoad }: Props) {
  const { panel, setPanel } = useWorkspaceLayout();
  const open = panel === "results";
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const summary = useMemo(() => run ? summarizeRun(run, roadNames) : null, [run, roadNames]);
  const [saved, setSaved] = useState<SavedRun[] | null>(null);
  const [pattern, setPattern] = useState<{ hour: number; extraVehicles: number; runs: number }[]>([]);
  const [database, setDatabase] = useState<"unknown" | "ready" | "unconfigured" | "error">("unknown");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");

  const refresh = async () => {
    try {
      const [runs, hours] = await Promise.all([fetch("/api/runs"), fetch("/api/runs/patterns")]);
      if (runs.status === 503) { setDatabase("unconfigured"); return; }
      if (!runs.ok) throw new Error();
      setSaved((await runs.json()).runs);
      if (hours.ok) setPattern((await hours.json()).hours);
      setDatabase("ready");
    } catch {
      setDatabase("error");
    }
  };
  useEffect(() => { if (open) { void refresh(); requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true })); } }, [open]);
  useEffect(() => { setName(items.map(item => item.title).filter(Boolean).slice(0, 3).join(" + ")); }, [items]);

  const save = async () => {
    if (!summary || !run) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name: name.trim() || "Untitled scenario", date, weather, disruptions: items, modelVersion: run.version, dataVersion,
        summary: { start: summary.start, end: summary.end, extraDelayHours: summary.extraDelayHours, peakExtraVehicles: summary.peakExtraVehicles, peakMinute: summary.peakMinute, unfinishedTrips: summary.unfinishedTrips, topRoads: summary.topRoads, series: summary.series },
      }) });
      const body = await response.json();
      if (response.status === 503) setDatabase("unconfigured");
      if (!response.ok) throw new Error(body.error ?? "Could not save this run.");
      setNotice("Run saved.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this run.");
    } finally {
      setSaving(false);
    }
  };

  const close = () => { setPanel(null); triggerRef.current?.focus({ preventScroll: true }); };
  const worst = summary?.topRoads[0];
  const maxPattern = Math.max(1, ...pattern.map(h => h.extraVehicles));

  return <div className="results-menu" data-map-ui>
    <GlassSurface variant="button"><button ref={triggerRef} type="button" className="toolbox-toggle results-toggle" data-panel-trigger="results" aria-label="Scenario results" aria-expanded={open} aria-controls={open ? id : undefined} title="Scenario results" onClick={() => setPanel(open ? null : "results")}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>
    </button></GlassSurface>
    <WorkspacePanel name="results" dismissOnDoubleClick><section id={id} className="toolbox-panel dashboard-panel" aria-label="Scenario results">
      <div className="toolbox-heading"><div><span className="toolbox-eyebrow">MEASURE THE IMPACT</span><h2>Results</h2></div><button ref={closeRef} className="toolbox-close" type="button" aria-label="Close results" onClick={close}><DisruptionIcon kind="close" /></button></div>

      {!items.length ? <p className="dashboard-note">Place a closure, event, accident or construction to compare it with a normal day.</p>
        : loading || !summary ? <p className="dashboard-note" role="status">Simulating traffic…</p> : <>
          <div className="dashboard-tiles">
            <div><span>Extra delay</span><strong>{number.format(summary.extraDelayHours)}</strong><small>vehicle-hours</small></div>
            <div><span>Extra vehicles on roads</span><strong>{number.format(summary.peakExtraVehicles)}</strong><small>at peak, {clock(summary.peakMinute)}</small></div>
            <div><span>Trips not finished</span><strong>{number.format(summary.unfinishedTrips)}</strong><small>by {clock(summary.end)}</small></div>
            <div><span>Worst street</span><strong className="dashboard-tile-text">{worst?.name ?? "None"}</strong><small>{worst ? `+${number.format(worst.extraQueue)} queued` : "no extra queues"}</small></div>
          </div>
          <VehiclesChart series={summary.series} now={minutes} />
          {summary.topRoads.length ? <div className="dashboard-section">
            <h3>Most affected streets</h3>
            <Bars label="Extra queued vehicles by street" unit="queued" rows={summary.topRoads.map(r => ({ key: r.id, name: r.name, value: r.extraQueue, detail: r.speedDropKmh >= 1 ? `−${number.format(r.speedDropKmh)} km/h` : undefined }))} onSelect={onSelectRoad} />
          </div> : null}
          <p className="dashboard-note">Simulated {clock(summary.start)}–{clock(summary.end)} on {date} from City traffic counts. Estimates, not measured traffic.</p>
        </>}

      <div className="dashboard-section">
        <h3>Saved runs</h3>
        {database === "unconfigured" ? <p className="dashboard-note">Connect Tiger Data to save and compare runs: set <code>TIGER_DATABASE_URL</code> in <code>.env.local</code>.</p> : null}
        {database === "error" ? <p className="dashboard-note">The scenario database could not be reached. <button type="button" className="dashboard-link" onClick={() => void refresh()}>Retry</button></p> : null}
        {database === "ready" && summary ? <form className="dashboard-save" onSubmit={event => { event.preventDefault(); void save(); }}>
          <label htmlFor={`${id}-name`}>Name this run</label>
          <div><input id={`${id}-name`} value={name} maxLength={80} onChange={event => setName(event.target.value)} placeholder="Untitled scenario" /><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save run"}</button></div>
        </form> : null}
        {notice ? <p className="dashboard-note" role="status">{notice}</p> : null}
        {database === "ready" && saved?.length ? <Bars label="Extra delay by saved run" unit="veh-h" rows={saved.slice(0, 8).map(r => ({ key: r.id, name: r.name, value: r.extraDelayHours, detail: `${r.date} · ${r.disruptionCount} disruption${r.disruptionCount === 1 ? "" : "s"}` }))} /> : null}
        {database === "ready" && saved && !saved.length ? <p className="dashboard-note">No saved runs yet.</p> : null}
        {database === "ready" && pattern.length ? <figure className="dashboard-chart">
          <figcaption>Extra vehicles by hour, across all saved runs</figcaption>
          <div className="dashboard-columns" role="img" aria-label={`Busiest hour across saved runs: ${clock(pattern.reduce((a, b) => b.extraVehicles > a.extraVehicles ? b : a).hour * 60)}`}>
            {Array.from({ length: 24 }, (_, hour) => {
              const value = pattern.find(h => h.hour === hour);
              return <span key={hour} title={value ? `${clock(hour * 60)}: ${number.format(value.extraVehicles)} extra vehicles (${value.runs} run${value.runs === 1 ? "" : "s"})` : `${clock(hour * 60)}: no data`}><i style={{ height: `${value ? Math.max(3, (value.extraVehicles / maxPattern) * 100) : 0}%` }} /></span>;
            })}
          </div>
          <div className="dashboard-columns-axis" aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span></div>
        </figure> : null}
      </div>
    </section></WorkspacePanel>
  </div>;
}
