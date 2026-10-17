import type { DayType } from "./types";

export function dateAtNoon(date: string) {
  return new Date(`${date}T12:00:00Z`);
}

export function validSimulationDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = dateAtNoon(date);
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === date;
}

export function shiftSimulationDate(date: string, days: number) {
  const value = dateAtNoon(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function simulationDayType(date: string): DayType {
  const day = dateAtNoon(date).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
}

export function simulationMonth(date: string, months: number) {
  const value = dateAtNoon(date);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + months);
  const last = new Date(value.getTime());
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  value.setUTCDate(Math.min(day, last.getUTCDate()));
  return value.toISOString().slice(0, 10);
}

export function simulationCalendar(date: string) {
  const first = `${date.slice(0, 7)}-01`;
  const start = shiftSimulationDate(first, -dateAtNoon(first).getUTCDay());
  return Array.from({ length: 42 }, (_, index) => shiftSimulationDate(start, index));
}

const shortDate = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const fullDate = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric" });

export function formatSimulationDate(date: string, full = false) {
  return (full ? fullDate : shortDate).format(dateAtNoon(date));
}
