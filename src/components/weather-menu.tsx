"use client";

import { useEffect, useId, useRef } from "react";
import GlassSurface from "./glass-surface";
import { CLEAR_WEATHER, weatherIntensity, weatherLevel, weatherSummary, type WeatherState } from "@/lib/weather";

function WeatherIcon({ kind }: { kind: "weather" | "rain" | "snow" }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === "snow" ? <><path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9 5l3 3 3-3M9 19l3-3 3 3M4.5 11l4-1-1-4M19.5 13l-4 1 1 4M7.5 18l1-4-4-1M16.5 6l-1 4 4 1" /></> : <><path d="M7 15a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.5 1.2A3.5 3.5 0 1 1 18 15H7Z" /><path d={kind === "rain" ? "m8 18-1 3m6-3-1 3m6-3-1 3" : "m9 18-1 3m8-3-1 3"} /></>}</svg>;
}

export default function WeatherMenu({ open, onOpenChange, weather, onChange }: { open: boolean; onOpenChange: (open: boolean) => void; weather: WeatherState; onChange: (weather: WeatherState) => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const active = weather.rain > 0 || weather.snow > 0;
  const close = () => { onOpenChange(false); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) onOpenChange(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside, true);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside, true); };
  }, [open, onOpenChange]);

  return <div className="weather-menu" data-map-ui>
    <GlassSurface variant="button"><button ref={triggerRef} type="button" className="toolbox-toggle weather-toggle" aria-label={`Weather settings: ${weatherSummary(weather)}`} aria-expanded={open} aria-controls={open ? id : undefined} title="Weather settings" onClick={() => onOpenChange(!open)}><WeatherIcon kind="weather" />{active ? <span className="weather-active-dot" aria-hidden="true" /> : null}</button></GlassSurface>
    {open ? <section ref={panelRef} id={id} className="toolbox-panel weather-panel" aria-label="Weather settings">
      <div className="toolbox-heading"><div><span className="toolbox-eyebrow">SET THE CONDITIONS</span><h2>Weather</h2></div><button ref={closeRef} className="toolbox-close" type="button" aria-label="Close weather settings" onClick={close}>×</button></div>
      <p className="weather-summary" role="status">{weatherSummary(weather)}</p>
      {(["rain", "snow"] as const).map(kind => <div key={kind} className="weather-slider-group">
        <div className="weather-slider-heading"><label htmlFor={`${id}-${kind}`}><WeatherIcon kind={kind} />{kind === "rain" ? "Rain" : "Snow"}</label><output htmlFor={`${id}-${kind}`}>{weatherLevel(weather[kind])}<span>{weather[kind]}%</span></output></div>
        <input id={`${id}-${kind}`} type="range" min="0" max="100" step="1" value={weather[kind]} aria-valuetext={`${weatherLevel(weather[kind])}, ${weather[kind]} percent`} onChange={event => onChange({ ...weather, [kind]: weatherIntensity(Number(event.target.value)) })} />
        <div className="weather-slider-scale" aria-hidden="true"><span>Off</span><span>Heavy</span></div>
      </div>)}
      <button className="weather-clear" type="button" disabled={!active} onClick={() => onChange(CLEAR_WEATHER)}>Clear weather</button>
      <p className="weather-note">Mix rain and snow, or set both to zero for clear skies. Intensity is relative, not a measured forecast. Traffic estimates currently use dry-road assumptions.</p>
    </section> : null}
  </div>;
}
