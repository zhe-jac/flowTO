"use client";

import { useEffect, useId, useRef } from "react";
import { WorkspacePanel } from "./workspace-layout";
import GlassSurface from "./glass-surface";
import DisruptionIcon from "./disruption-icon";
import SlidingControl from "./sliding-control";
import type { TorontoWeather, WeatherMode } from "@/lib/current-weather";
import { CLEAR_WEATHER, weatherIntensity, weatherLevel, weatherSummary, type WeatherState } from "@/lib/weather";

function WeatherIcon({ kind }: { kind: "weather" | "rain" | "snow" }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "snow" ? <><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3M4.5 11l4-1-1-4M19.5 13l-4 1 1 4M7.5 18l1-4-4-1M16.5 6l-1 4 4 1" /></> : <><path d="M7 15a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.5 1.2A3.5 3.5 0 1 1 18 15H7Z" /><path d={kind === "rain" ? "m8 18-1 3m6-3-1 3m6-3-1 3" : "m9 18-1 3m8-3-1 3"} /></>}</svg>;
}

const weatherTime = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const rateFormat = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  weather: WeatherState;
  onChange: (weather: WeatherState) => void;
  mode: WeatherMode;
  reading: TorontoWeather | null;
  status: "idle" | "loading" | "ready" | "error";
  presentTime: boolean;
  onModeChange: (mode: WeatherMode) => void;
  onRefresh: () => void;
};

export default function WeatherMenu({ open, onOpenChange, weather, onChange, mode, reading, status, presentTime, onModeChange, onRefresh }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = weather.rain > 0 || weather.snow > 0;
  const close = () => { onOpenChange(false); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
  }, [open, onOpenChange]);

  return <div className="weather-menu" data-map-ui>
    <GlassSurface variant="button"><button ref={triggerRef} type="button" className="toolbox-toggle weather-toggle" data-panel-trigger="weather" aria-label={`Weather settings: ${weatherSummary(weather)}`} aria-expanded={open} aria-controls={open ? id : undefined} title="Weather settings" onClick={() => onOpenChange(!open)}><WeatherIcon kind="weather" />{active ? <span className="weather-active-dot" aria-hidden="true" /> : null}</button></GlassSurface>
    <WorkspacePanel name="weather"><section id={id} className="toolbox-panel weather-panel" aria-label="Weather settings">
      <div className="toolbox-heading"><div><span className="toolbox-eyebrow">SET THE CONDITIONS</span><h2>Weather</h2></div><button ref={closeRef} className="toolbox-close" type="button" aria-label="Close weather settings" onClick={close}><DisruptionIcon kind="close" /></button></div>
      <SlidingControl className="traffic-segmented weather-mode" label="Weather source" value={mode}>
        <button type="button" aria-pressed={mode === "current"} disabled={!presentTime} onClick={() => onModeChange("current")}>Current Toronto</button>
        <button type="button" aria-pressed={mode === "manual"} onClick={() => onModeChange("manual")}>Manual</button>
      </SlidingControl>
      {!presentTime ? <p className="weather-note">Select Current time in the top timeline to sync Toronto weather.</p> : null}
      <p className="weather-summary" role="status">{mode === "current" && !reading ? status === "error" ? "Weather unavailable" : "Loading Toronto weather…" : weatherSummary(weather)}</p>
      {mode === "current" ? <div className="weather-current-details">
        {reading ? <><span>Downtown Toronto · {weatherTime.format(new Date(reading.validAt))}</span><span>Rain {rateFormat.format(reading.rainMmPerHour)} mm/h · Snow {rateFormat.format(reading.snowCmPerHour)} cm/h</span></> : null}
        {status === "error" ? <p role="status">{reading ? "Couldn’t refresh. Keeping the last values." : "Couldn’t load current weather. Adjust manually or try again."}</p> : null}
        <div><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a><span> · model estimate</span><button type="button" disabled={status === "loading"} onClick={onRefresh}>{status === "loading" ? "Updating…" : status === "error" ? "Retry" : "Refresh"}</button></div>
      </div> : null}
      {(["rain", "snow"] as const).map(kind => <div key={kind} className="weather-slider-group">
        <div className="weather-slider-heading"><label htmlFor={`${id}-${kind}`}><WeatherIcon kind={kind} />{kind === "rain" ? "Rain" : "Snow"}</label><output htmlFor={`${id}-${kind}`}>{weatherLevel(weather[kind])}<span>{weather[kind]}%</span></output></div>
        <input id={`${id}-${kind}`} type="range" min="0" max="100" step="1" value={weather[kind]} aria-valuetext={`${weatherLevel(weather[kind])}, ${weather[kind]} percent`} onChange={event => onChange({ ...weather, [kind]: weatherIntensity(Number(event.target.value)) })} />
        <div className="weather-slider-scale" aria-hidden="true"><span>Off</span><span>Heavy</span></div>
      </div>)}
      <button className="weather-clear" type="button" disabled={!active && mode === "manual"} onClick={() => onChange(CLEAR_WEATHER)}>Clear weather</button>
    </section></WorkspacePanel>
  </div>;
}
