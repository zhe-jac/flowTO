"use client";
import { useState, useMemo } from "react";
import { createDockGesture } from "@/lib/dock-gestures";
import { CLOCK_RATES, clockOnDate, torontoNow, type ClockState } from "@/lib/traffic/clock";
import { formatClock, MINUTES_PER_DAY } from "@/lib/traffic/model";
import SimulationDatePicker from "./simulation-date-picker";
import { WorkspaceDockPane } from "../workspace-layout";
import SlidingControl from "../sliding-control";
const TICKS = [0, 360, 720, 1080, 1440];
const TIME_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
function profilePath(profile: number[], width: number, height: number) {
    const max = Math.max(...profile);
    const points = profile.map((value, index) => `${((index + 0.5) / profile.length) * width},${height - (value / max) * (height - 2)}`);
    return `M0,${height} L${points.join(" L")} L${width},${height} Z`;
}
type Props = {
    clock: ClockState;
    profile: number[];
    vehicles: number;
    disruptions: number;
    waiting: boolean;
    /** Short status of the active disruption scenario, shown inside the controls instead of a separate card. */
    scenario?: { text: string; retry?: () => void; compare: "before" | "after"; onCompare: (mode: "before" | "after") => void } | null;
    onChange: (change: Partial<ClockState>) => void;
    onScrubbingChange: (scrubbing: boolean) => void;
};
export default function TrafficControls({ clock, profile, vehicles, disruptions, waiting, scenario, onChange, onScrubbingChange }: Props) {
    const [scrubbing, setScrubbing] = useState(false);
    const [minimized, setMinimized] = useState(true);
    const collapsed = minimized;
    const toggleMinimized = () => setMinimized(value => !value);
    const gesture = useMemo(() => createDockGesture(), []);
    const changeScrubbing = (active: boolean) => { setScrubbing(active); onScrubbingChange(active); };
    const live = clock.rate.id === "live";
    const chooseRate = (id: string) => {
        const rate = CLOCK_RATES.find((item) => item.id === id) ?? CLOCK_RATES[1];
        onChange(rate.id === "live" ? { rate, playing: true, ...torontoNow() } : { rate, playing: true });
    };
    const chooseDate = (date: string) => {
        const next = clockOnDate(clock, date);
        onChange({ date: next.date, day: next.day, rate: next.rate });
    };
    return (<WorkspaceDockPane name="timeline"><div className="traffic-controls-shell" data-map-ui data-minimized={collapsed}><section className="traffic-controls" aria-label="Traffic simulation playback" onClick={event => { if (gesture.shouldExpand(collapsed, event.target, event.detail)) setMinimized(false); }} onDoubleClick={event => { if (!gesture.shouldCollapse(collapsed, event.target)) return; window.getSelection()?.removeAllRanges(); setMinimized(true); }}>
      <button type="button" className="traffic-minimize" aria-expanded={!collapsed} aria-label={collapsed ? "Expand traffic controls" : "Minimize traffic controls"} title={collapsed ? "Expand traffic controls" : "Minimize traffic controls"} onClick={toggleMinimized}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={collapsed ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} /></svg>
      </button>
      <div className="traffic-controls-row">
        <button type="button" className="traffic-play" aria-label={clock.playing ? "Pause traffic playback" : "Play traffic playback"} onClick={() => onChange({ playing: !clock.playing })}>
          {clock.playing ? (<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>) : (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.2v11.6a.7.7 0 0 0 1.06.6l9.3-5.8a.7.7 0 0 0 0-1.2l-9.3-5.8A.7.7 0 0 0 4 2.2z"/></svg>)}
        </button>
        <div className="traffic-clock-group">
        <div className="traffic-clock">
          <strong aria-live="off">{formatClock(clock.minutes)}</strong>
          <span>
            Typical {clock.day} · {waiting ? "playback held" : !clock.playing ? "paused" : live ? "current Toronto time" : "playback"}
          </span>
        </div>
        <SimulationDatePicker value={clock.date} onChange={chooseDate} dismissKey={String(collapsed)} />
        </div>
        <SlidingControl className="traffic-segmented" label="Playback speed" value={clock.rate.id}>
          {CLOCK_RATES.map((rate) => (<button key={rate.id} type="button" aria-pressed={clock.rate.id === rate.id} onClick={() => chooseRate(rate.id)}>
              {rate.label}
            </button>))}
        </SlidingControl>
      </div>
      {scenario ? <SlidingControl className="traffic-segmented traffic-compare" label="Compare with normal traffic" value={scenario.compare}>
        {(["before", "after"] as const).map((mode) => <button key={mode} type="button" aria-pressed={scenario.compare === mode} onClick={() => scenario.onCompare(mode)}>{mode === "before" ? "Before" : "After"}</button>)}
      </SlidingControl> : null}
      <p className="traffic-estimate">Estimated traffic · ≈ {Math.round(vehicles).toLocaleString()} vehicles on roads{disruptions ? ` · ${disruptions} active ${disruptions === 1 ? "disruption" : "disruptions"}` : ""}{scenario ? <> · {scenario.text}{scenario.retry ? <> <button type="button" className="traffic-estimate-retry" onClick={scenario.retry}>Retry</button></> : null}</> : null}</p>
      <div className="traffic-timeline" data-scrubbing={scrubbing}>
        <div className="traffic-time-indicator-track" aria-hidden="true"><span className="traffic-time-indicator" style={{ left: `${Math.floor(clock.minutes) / (MINUTES_PER_DAY - 1) * 100}%` }} /></div>
        <svg className="traffic-profile" viewBox="0 0 960 34" preserveAspectRatio="none" aria-hidden="true">
          <path d={profilePath(profile, 960, 34)}/>
        </svg>
        <input type="range" min={0} max={MINUTES_PER_DAY - 1} step={1} value={Math.floor(clock.minutes)} aria-label="Time of day" aria-valuetext={formatClock(clock.minutes)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); changeScrubbing(true); }} onPointerUp={() => changeScrubbing(false)} onPointerCancel={() => changeScrubbing(false)} onLostPointerCapture={() => changeScrubbing(false)} onKeyDown={event => { if (TIME_KEYS.has(event.key)) changeScrubbing(true); }} onKeyUp={event => { if (TIME_KEYS.has(event.key)) changeScrubbing(false); }} onBlur={() => changeScrubbing(false)} onChange={(event) => onChange({ minutes: Number(event.target.value), rate: live ? CLOCK_RATES[1] : clock.rate })}/>
        <div className="traffic-ticks" aria-hidden="true">
          {TICKS.map((minute) => <span key={minute}>{minute === 1440 ? "12 AM" : formatClock(minute).replace(":00", "")}</span>)}
        </div>
      </div>
    </section></div></WorkspaceDockPane>);
}
