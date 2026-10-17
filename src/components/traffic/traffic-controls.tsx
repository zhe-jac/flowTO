"use client";
import { CLOCK_RATES, torontoNow, type ClockState } from "@/lib/traffic/clock";
import { formatClock, MINUTES_PER_DAY } from "@/lib/traffic/model";
import type { DayType } from "@/lib/traffic/types";
import GlassSurface from "../glass-surface";
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
    onChange: (change: Partial<ClockState>) => void;
};
export default function TrafficControls({ clock, profile, vehicles, closures, onChange }: Props) {
    const live = clock.rate.id === "live";
    const chooseRate = (id: string) => {
        const rate = CLOCK_RATES.find((item) => item.id === id) ?? CLOCK_RATES[1];
        onChange(rate.id === "live" ? { rate, playing: true, ...torontoNow() } : { rate, playing: true });
    };
    const chooseDay = (day: DayType) => onChange({ day, rate: live ? CLOCK_RATES[1] : clock.rate });
    return (<div className="traffic-controls-shell" data-map-ui><GlassSurface variant="panel"><section className="traffic-controls" aria-label="Typical traffic playback">
      <div className="traffic-controls-row">
        <button type="button" className="traffic-play" aria-label={clock.playing ? "Pause traffic playback" : "Play traffic playback"} onClick={() => onChange({ playing: !clock.playing })}>
          {clock.playing ? (<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1"/><rect x="9.5" y="2" width="3.5" height="12" rx="1"/></svg>) : (<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.2v11.6a.7.7 0 0 0 1.06.6l9.3-5.8a.7.7 0 0 0 0-1.2l-9.3-5.8A.7.7 0 0 0 4 2.2z"/></svg>)}
        </button>
        <div className="traffic-clock">
          <strong aria-live="off">{formatClock(clock.minutes)}</strong>
          <span>
            Typical {clock.day} · {live ? "current Toronto time" : "playback"}
          </span>
        </div>
        <div className="traffic-segmented" role="group" aria-label="Day type">
          {(["weekday", "weekend"] as const).map((day) => (<button key={day} type="button" aria-pressed={clock.day === day} onClick={() => chooseDay(day)}>
              {day === "weekday" ? "Weekday" : "Weekend"}
            </button>))}
        </div>
        <div className="traffic-segmented" role="group" aria-label="Playback speed">
          {CLOCK_RATES.map((rate) => (<button key={rate.id} type="button" aria-pressed={clock.rate.id === rate.id} onClick={() => chooseRate(rate.id)}>
              {rate.label}
            </button>))}
        </div>
      </div>
      <p className="traffic-estimate">Estimated traffic · ≈ {Math.round(vehicles).toLocaleString()} vehicles on roads{closures ? ` · ${closures} full ${closures === 1 ? "closure" : "closures"} applied, without rerouting` : ""}</p>
      <div className="traffic-timeline">
        <svg className="traffic-profile" viewBox="0 0 960 34" preserveAspectRatio="none" aria-hidden="true">
          <path d={profilePath(profile, 960, 34)}/>
        </svg>
        <input type="range" min={0} max={MINUTES_PER_DAY - 1} step={1} value={Math.floor(clock.minutes)} aria-label="Time of day" aria-valuetext={formatClock(clock.minutes)} onChange={(event) => onChange({ minutes: Number(event.target.value), rate: live ? CLOCK_RATES[1] : clock.rate })}/>
        <div className="traffic-ticks" aria-hidden="true">
          {TICKS.map((minute) => <span key={minute}>{minute === 1440 ? "12 AM" : formatClock(minute).replace(":00", "")}</span>)}
        </div>
      </div>
    </section></GlassSurface></div>);
}
