"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { createPortal } from "react-dom";
import { torontoNow } from "@/lib/traffic/clock";
import { dateAtNoon, formatSimulationDate, shiftSimulationDate, simulationCalendar, simulationDayType, simulationMonth } from "@/lib/traffic/simulation-date";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function CalendarIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" /></svg>;
}

function Calendar({ value, onChange, onClose, triggerRef, id }: { value: string; onChange: (date: string) => void; onClose: (restoreFocus?: boolean) => void; triggerRef: RefObject<HTMLButtonElement | null>; id: string }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeDate, setActiveDate] = useState(value);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  const focusDay = useRef(true);
  const today = torontoNow().date;
  const cells = useMemo(() => simulationCalendar(activeDate), [activeDate]);
  const current = dateAtNoon(activeDate);
  const year = current.getUTCFullYear();
  const month = current.getUTCMonth();
  const years = Array.from({ length: 11 }, (_, index) => year - 5 + index).filter(value => value > 0 && value < 10000);
  const selectDate = (date: string) => { onChange(date); onClose(true); };

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;
    const shell = trigger.closest(".traffic-controls-shell") ?? trigger;
    const place = () => {
      const anchor = trigger.getBoundingClientRect();
      const bar = shell.getBoundingClientRect();
      const rect = panel.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - rect.width - 12, anchor.left + anchor.width / 2 - rect.width / 2));
      const top = Math.max(12, bar.top - rect.height - 10);
      setPosition(previous => previous.ready && previous.left === left && previous.top === top ? previous : { left, top, ready: true });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    observer.observe(shell);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [triggerRef]);

  useEffect(() => {
    if (position.ready && focusDay.current) {
      panelRef.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${activeDate}"]`)?.focus({ preventScroll: true });
      focusDay.current = false;
    }
  }, [activeDate, position.ready]);

  useEffect(() => {
    const outside = (event: Event) => {
      const target = event.target as Node | null;
      if (target && !panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) onClose();
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(true); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape, true); };
  }, [onClose, triggerRef]);

  const moveFocus = (event: KeyboardEvent) => {
    if (!(event.target as HTMLElement).hasAttribute("data-calendar-date")) return;
    const weekday = dateAtNoon(activeDate).getUTCDay();
    let next: string;
    switch (event.key) {
      case "ArrowLeft": next = shiftSimulationDate(activeDate, -1); break;
      case "ArrowRight": next = shiftSimulationDate(activeDate, 1); break;
      case "ArrowUp": next = shiftSimulationDate(activeDate, -7); break;
      case "ArrowDown": next = shiftSimulationDate(activeDate, 7); break;
      case "Home": next = shiftSimulationDate(activeDate, -weekday); break;
      case "End": next = shiftSimulationDate(activeDate, 6 - weekday); break;
      case "PageUp": next = simulationMonth(activeDate, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = simulationMonth(activeDate, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault();
    focusDay.current = true;
    setActiveDate(next);
  };

  return createPortal(<div ref={panelRef} id={id} className="simulation-calendar" role="dialog" aria-label="Choose simulation date" data-map-ui style={{ left: position.left, top: position.top, visibility: position.ready ? "visible" : "hidden" }}>
    <div className="simulation-calendar-heading"><span>SIMULATION DATE</span><button type="button" className="simulation-calendar-close" aria-label="Close calendar" onClick={() => onClose(true)}>×</button></div>
    <div className="simulation-calendar-navigation">
      <button type="button" aria-label="Previous month" onClick={() => setActiveDate(simulationMonth(activeDate, -1))}>‹</button>
      <div className="simulation-calendar-month">
        <select aria-label="Month" value={month} onChange={event => setActiveDate(simulationMonth(activeDate, Number(event.target.value) - month))}>{MONTHS.map((label, index) => <option key={label} value={index}>{label}</option>)}</select>
        <select aria-label="Year" value={year} onChange={event => setActiveDate(simulationMonth(activeDate, (Number(event.target.value) - year) * 12))}>{years.map(value => <option key={value} value={value}>{value}</option>)}</select>
      </div>
      <button type="button" aria-label="Next month" onClick={() => setActiveDate(simulationMonth(activeDate, 1))}>›</button>
    </div>
    <div role="grid" aria-label={`${MONTHS[month]} ${year}`} onKeyDown={moveFocus}>
      <div className="simulation-calendar-week" role="row">{DAYS.map(day => <span key={day} role="columnheader" aria-label={day}>{day.slice(0, 2)}</span>)}</div>
      {Array.from({ length: 6 }, (_, row) => <div key={row} className="simulation-calendar-week" role="row">{cells.slice(row * 7, row * 7 + 7).map(date => <button key={date} type="button" role="gridcell" data-calendar-date={date} data-outside={date.slice(0, 7) !== activeDate.slice(0, 7)} aria-selected={date === value} aria-current={date === today ? "date" : undefined} aria-label={formatSimulationDate(date, true)} tabIndex={date === activeDate ? 0 : -1} onClick={() => selectDate(date)}>{Number(date.slice(-2))}</button>)}</div>)}
    </div>
    <div className="simulation-calendar-footer"><span>{simulationDayType(value) === "weekend" ? "Weekend" : "Weekday"} traffic profile</span><button type="button" onClick={() => selectDate(today)}>Today</button></div>
    <p className="simulation-calendar-note">Typical traffic estimates, not historical observations.</p>
  </div>, document.body);
}

export default function SimulationDatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback((restoreFocus = false) => { setOpen(false); if (restoreFocus) triggerRef.current?.focus({ preventScroll: true }); }, []);

  return <>
    <button ref={triggerRef} type="button" className="simulation-date-trigger" aria-label={`Simulation date: ${formatSimulationDate(value, true)}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} title={formatSimulationDate(value, true)} onClick={() => setOpen(value => !value)}><CalendarIcon /><span>{formatSimulationDate(value)}</span><svg className="simulation-date-chevron" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={open ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} /></svg></button>
    {open ? <Calendar value={value} onChange={onChange} onClose={close} triggerRef={triggerRef} id={id} /> : null}
  </>;
}
