"use client";
import { useState } from "react";
import { CLOCK_RATES, torontoNow, type ClockState } from "@/lib/traffic/clock";
import { formatClock, MINUTES_PER_DAY } from "@/lib/traffic/model";
import type { DayType } from "@/lib/traffic/types";
import { AnimatePresence, motion, type Transition } from "motion/react";
import GlassSurface from "../glass-surface";
import SlidingControl from "../sliding-control";
const TICKS = [0, 360, 720, 1080, 1440];
function profilePath(profile: number[], width: number, height: number) {
    const max = Math.max(...profile);
    const points = profile.map((value, index) => `${((index + 0.5) / profile.length) * width},${height - (value / max) * (height - 2)}`);
    return `M0,${height} L${points.join(" L")} L${width},${height} Z`;
}
type Props = {
    clock: ClockState;
    profile: number[];
    vehicles: number;
    closures: number;
    /** Short status of the active disruption scenario, shown inside the controls instead of a separate card. */
    scenario?: { text: string; retry?: () => void; compare: "before" | "after"; onCompare: (mode: "before" | "after") => void } | null;
    onChange: (change: Partial<ClockState>) => void;
};
const PANEL_SPRING: Transition = { type: "spring", stiffness: 260, damping: 25 };
const FADE = { initial: { opacity: 0 }, animate: { opacity: 1, transition: { duration: 0.2, delay: 0.08 } }, exit: { opacity: 0, transition: { duration: 0.1 } } };
const MINIMIZED_KEY = "toronto-sandbox:controls-minimized";

export default function TrafficControls({ clock, profile, vehicles, closures, scenario, onChange }: Props) {
    const [scrubbing, setScrubbing] = useState(false);
    const [minimized, setMinimized] = useState(() => { try { return localStorage.getItem(MINIMIZED_KEY) === "1"; } catch { return false; } });
    const toggleMinimized = () => setMinimized((value) => {
        try { localStorage.setItem(MINIMIZED_KEY, value ? "0" : "1"); } catch { /* storage unavailable */ }
        return !value;
    });
    const live = clock.rate.id === "live";
    const chooseRate = (id: string) => {
        const rate = CLOCK_RATES.find((item) => item.id === id) ?? CLOCK_RATES[1];
        onChange(rate.id === "live" ? { rate, playing: true, ...torontoNow() } : { rate, playing: true });
    };
    const chooseDay = (day: DayType) => onChange({ day, rate: live ? CLOCK_RATES[1] : clock.rate });
    const minimizeButton = <button type="button" className="traffic-minimize" aria-label={minimized ? "Expand traffic playback" : "Minimize traffic playback"} aria-expanded={!minimized} onClick={toggleMinimized}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d={minimized ? "M3.5 10l4.5-4.5 4.5 4.5" : "M3.5 6l4.5 4.5 4.5-4.5"} /></svg>
      </button>;
    return (<div className="traffic-controls-shell" data-map-ui data-minimized={minimized}><GlassSurface variant="panel"><motion.section layout transition={PANEL_SPRING} style={{ borderRadius: 24 }} className="traffic-controls" aria-label="Typical traffic playback">
      <motion.div layout="position" className="traffic-controls-row">
        <button type="button" className="traffic-play" aria-label={clock.playing ? "Pause traffic playback" : "Play traffic playback"} onClick={() => onChange({ playing: !clock.playing })}>
          {clock.playing ? (<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>) : (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.2v11.6a.7.7 0 0 0 1.06.6l9.3-5.8a.7.7 0 0 0 0-1.2l-9.3-5.8A.7.7 0 0 0 4 2.2z"/></svg>)}
        </button>
        <div className="traffic-clock">
          <strong aria-live="off">{formatClock(clock.minutes)}</strong>
          <span>
            Typical {clock.day} · {live ? "current Toronto time" : "playback"}
          </span>
        </div>
        <AnimatePresence initial={false} mode="popLayout">
        {minimized ? null : <motion.div key="options" className="traffic-controls-options" {...FADE}>
        <SlidingControl className="traffic-segmented" label="Day type" value={clock.day}>
          {(["weekday", "weekend"] as const).map((day) => (<button key={day} type="button" aria-pressed={clock.day === day} onClick={() => chooseDay(day)}>
              {day === "weekday" ? "Weekday" : "Weekend"}
            </button>))}
        </SlidingControl>
        <SlidingControl className="traffic-segmented" label="Playback speed" value={clock.rate.id}>
          {CLOCK_RATES.map((rate) => (<button key={rate.id} type="button" aria-pressed={clock.rate.id === rate.id} onClick={() => chooseRate(rate.id)}>
              {rate.label}
            </button>))}
        </SlidingControl>
        </motion.div>}
        </AnimatePresence>
        {minimizeButton}
      </motion.div>
      <AnimatePresence initial={false}>
      {minimized ? null : <motion.div key="details" layout="position" className="traffic-controls-details" {...FADE}>
      {scenario ? <div className="traffic-segmented traffic-compare" role="group" aria-label="Compare with normal traffic">
        {(["before", "after"] as const).map((mode) => <button key={mode} type="button" aria-pressed={scenario.compare === mode} onClick={() => scenario.onCompare(mode)}>{mode === "before" ? "Before" : "After"}</button>)}
      </div> : null}
      <p className="traffic-estimate">Estimated traffic · ≈ {Math.round(vehicles).toLocaleString()} vehicles on roads{closures ? ` · ${closures} full ${closures === 1 ? "closure" : "closures"} applied` : ""}{scenario ? <> · {scenario.text}{scenario.retry ? <> <button type="button" className="traffic-estimate-retry" onClick={scenario.retry}>Retry</button></> : null}</> : null}</p>
      <div className="traffic-timeline" data-scrubbing={scrubbing}>
        <div className="traffic-time-indicator-track" aria-hidden="true"><span className="traffic-time-indicator" style={{ left: `${Math.floor(clock.minutes) / (MINUTES_PER_DAY - 1) * 100}%` }} /></div>
        <svg className="traffic-profile" viewBox="0 0 960 34" preserveAspectRatio="none" aria-hidden="true">
          <path d={profilePath(profile, 960, 34)}/>
        </svg>
        <input type="range" min={0} max={MINUTES_PER_DAY - 1} step={1} value={Math.floor(clock.minutes)} aria-label="Time of day" aria-valuetext={formatClock(clock.minutes)} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setScrubbing(true); }} onPointerUp={() => setScrubbing(false)} onPointerCancel={() => setScrubbing(false)} onLostPointerCapture={() => setScrubbing(false)} onBlur={() => setScrubbing(false)} onChange={(event) => onChange({ minutes: Number(event.target.value), rate: live ? CLOCK_RATES[1] : clock.rate })}/>
        <div className="traffic-ticks" aria-hidden="true">
          {TICKS.map((minute) => <span key={minute}>{minute === 1440 ? "12 AM" : formatClock(minute).replace(":00", "")}</span>)}
        </div>
      </div>
      </motion.div>}
      </AnimatePresence>
    </motion.section></GlassSurface></div>);
}
