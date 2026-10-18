import assert from "node:assert/strict";
import test from "node:test";
import { advanceClock, advancePlayback, changePlayback, clockOnDate, CLOCK_RATES, initialTrafficClock, torontoNow, type ClockState } from "./clock";
import { dateAtNoon, formatSimulationDate, shiftSimulationDate, simulationCalendar, simulationDayType, simulationMonth, validSimulationDate } from "./simulation-date";
import { simulatorLight, sunTimes } from "../daylight";

const now = new Date("2026-10-17T16:30:00Z");
const clock: ClockState = { date: "2026-10-16", minutes: 1439, day: "weekday", playing: true, rate: CLOCK_RATES[1] };

test("simulation dates validate actual calendar days including leap years", () => {
  for (const date of ["2024-02-29", "2026-10-17", "2026-12-31"]) assert.equal(validSimulationDate(date), true);
  for (const date of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-1-1", "", "bad"]) assert.equal(validSimulationDate(date), false);
  assert.equal(simulationDayType("2026-10-16"), "weekday");
  assert.equal(simulationDayType("2026-10-17"), "weekend");
  assert.equal(simulationDayType("2026-10-18"), "weekend");
});

test("Toronto clock date uses Toronto midnight and daylight saving offsets", () => {
  assert.equal(torontoNow(new Date("2026-01-01T04:59:00Z")).date, "2025-12-31");
  assert.equal(torontoNow(new Date("2026-01-01T05:00:00Z")).date, "2026-01-01");
  assert.equal(torontoNow(new Date("2026-07-01T03:59:00Z")).date, "2026-06-30");
  assert.equal(torontoNow(new Date("2026-07-01T04:00:00Z")).date, "2026-07-01");
  assert.equal(torontoNow(new Date("2026-03-08T07:00:00Z")).minutes, 180);
});

test("playback advances the calendar and traffic day type across midnight, leap day and New Year", () => {
  assert.deepEqual(advanceClock(clock, 2), { ...clock, date: "2026-10-17", minutes: 1, day: "weekend" });
  assert.equal(advanceClock({ ...clock, date: "2024-02-28" }, 61).date, "2024-02-29");
  assert.equal(advanceClock({ ...clock, date: "2026-12-31" }, 61).date, "2027-01-01");
  const multipleDays = advanceClock(clock, 1440 * 3 + 2);
  assert.equal(multipleDays.date, "2026-10-20");
  assert.equal(multipleDays.minutes, 1);
  const paused = { ...clock, playing: false };
  assert.equal(advanceClock(paused, 1000), paused);
});

test("waiting for a simulation holds every playback speed without skipping the closure's start", () => {
  for (const rate of CLOCK_RATES) {
    const start = { ...clock, date: "2026-10-18", minutes: 735, rate };
    let held = start;
    for (let i = 0; i < 40; i++) held = advancePlayback(held, 0.5, { waiting: true, scrubbing: false }, now);
    assert.equal(held, start);
    const resumed = advancePlayback(held, 0.5, { waiting: false, scrubbing: false }, now);
    assert.equal(resumed.minutes, rate.id === "live" ? torontoNow(now).minutes : start.minutes + rate.minutesPerSecond * 0.5);
  }
});

test("Play and playback speed controls cannot bypass processing, editing or a failed simulation", () => {
  const paused = { ...clock, playing: false };
  for (const gate of [{ loading: true, editing: false, failed: false }, { loading: false, editing: true, failed: false }, { loading: false, editing: false, failed: true }]) {
    for (const rate of CLOCK_RATES) {
      const blocked = changePlayback(paused, { playing: true, rate }, gate);
      assert.equal(blocked.clock.playing, false);
      assert.equal(blocked.clock.minutes, paused.minutes);
      assert.ok(blocked.notice);
    }
  }
  const ready = changePlayback(paused, { playing: true }, { loading: false, editing: false, failed: false });
  assert.equal(ready.clock.playing, true);
  assert.equal(ready.notice, null);
});

test("manual seeking remains available while processing and a paused clock stays paused when ready", () => {
  const paused = { ...clock, playing: false };
  const sought = changePlayback(paused, { minutes: 750 }, { loading: true, editing: false, failed: false });
  assert.equal(sought.clock.minutes, 750);
  assert.equal(sought.clock.playing, false);
  assert.equal(sought.notice, null);
  assert.equal(advancePlayback(sought.clock, 10, { waiting: false, scrubbing: false }), sought.clock);
  assert.equal(advancePlayback(clock, 10, { waiting: false, scrubbing: true }), clock);
});

test("choosing a date preserves the time and playback state while leaving live mode", () => {
  const live: ClockState = { ...clock, minutes: 745.5, rate: CLOCK_RATES[0], playing: false };
  assert.deepEqual(clockOnDate(live, "2026-10-18"), { ...live, date: "2026-10-18", day: "weekend", rate: CLOCK_RATES[1] });
  assert.equal(clockOnDate(clock, "2026-10-18").rate, clock.rate);
  assert.equal(clockOnDate(live, "2026-02-30"), live);
  assert.deepEqual(advanceClock({ ...live, playing: true }, 1, now), { ...live, playing: true, ...torontoNow(now) });
});

test("date URLs determine the traffic profile and legacy day URLs remain consistent with the date", () => {
  const selected = initialTrafficClock("?date=2026-10-19&time=18:30&day=weekend", now);
  assert.equal(selected.date, "2026-10-19");
  assert.equal(selected.day, "weekday");
  assert.equal(selected.minutes, 1110);
  assert.equal(selected.rate.id, "1m");
  const legacy = initialTrafficClock("?day=weekday", now);
  assert.equal(legacy.date, "2026-10-19");
  assert.equal(legacy.day, simulationDayType(legacy.date));
  assert.equal(initialTrafficClock("?date=2026-02-30", now).rate.id, "live");
  assert.equal(initialTrafficClock("?date=2026-02-30", now).date, "2026-10-17");
  assert.equal(initialTrafficClock("?date=2026-06-21&speed=15m", now).rate.id, "15m");
});

test("calendar weeks stay continuous and month navigation clamps short months", () => {
  const cells = simulationCalendar("2026-10-17");
  assert.equal(cells.length, 42);
  assert.equal(dateAtNoon(cells[0]).getUTCDay(), 0);
  assert.ok(cells.includes("2026-10-01") && cells.includes("2026-10-31"));
  for (let index = 1; index < cells.length; index++) assert.equal(cells[index], shiftSimulationDate(cells[index - 1], 1));
  assert.equal(simulationMonth("2026-01-31", 1), "2026-02-28");
  assert.equal(simulationMonth("2024-01-31", 1), "2024-02-29");
  assert.equal(simulationMonth("2024-02-29", 12), "2025-02-28");
  assert.match(formatSimulationDate("2026-10-17", true), /2026/);
});

test("the selected date produces seasonal daylight instead of always using today's sunrise", () => {
  const summer = dateAtNoon("2026-06-21"), winter = dateAtNoon("2026-12-21");
  assert.ok(sunTimes(summer).sunset > sunTimes(winter).sunset + 180);
  assert.equal(simulatorLight(19 * 60, summer).theme, "day");
  assert.equal(simulatorLight(19 * 60, winter).theme, "night");
});
