import { MINUTES_PER_DAY } from "./model";
import type { DayType } from "./types";
export type ClockRate = {
    id: string;
    label: string;
    minutesPerSecond: number;
};
export const CLOCK_RATES: ClockRate[] = [
    { id: "live", label: "Current time", minutesPerSecond: 1 / 60 },
    { id: "1m", label: "1 min/s", minutesPerSecond: 1 },
    { id: "5m", label: "5 min/s", minutesPerSecond: 5 },
    { id: "15m", label: "15 min/s", minutesPerSecond: 15 },
];
export type ClockState = {
    minutes: number;
    day: DayType;
    playing: boolean;
    rate: ClockRate;
};
export function torontoNow(date = new Date()): {
    minutes: number;
    day: DayType;
} {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Toronto",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
        weekday: "short",
    }).formatToParts(date).map((part) => [part.type, part.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60;
    return { minutes, day: parts.weekday === "Sat" || parts.weekday === "Sun" ? "weekend" : "weekday" };
}
export function advanceClock(state: ClockState, seconds: number, now = new Date()): ClockState {
    if (!state.playing)
        return state;
    if (state.rate.id === "live")
        return { ...state, ...torontoNow(now) };
    const minutes = (state.minutes + seconds * state.rate.minutesPerSecond) % MINUTES_PER_DAY;
    return { ...state, minutes };
}

export function initialTrafficClock(search: string, now = new Date()): ClockState {
    const clock: ClockState = { ...torontoNow(now), playing: true, rate: CLOCK_RATES[0] };
    const params = new URLSearchParams(search);
    const time = params.get("time")?.match(/^(\d{1,2}):(\d{2})$/);
    const validTime = !!time && Number(time[1]) < 24 && Number(time[2]) < 60;
    if (validTime) clock.minutes = Number(time[1]) * 60 + Number(time[2]);
    const day = params.get("day");
    if (day === "weekday" || day === "weekend") clock.day = day;
    const rate = CLOCK_RATES.find((item) => item.id === params.get("speed"));
    if (rate) clock.rate = rate;
    if (clock.rate.id === "live" && (validTime || day === "weekday" || day === "weekend")) clock.rate = CLOCK_RATES[1];
    return clock;
}
