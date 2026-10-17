"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CLEAR_WEATHER, type WeatherState } from "@/lib/weather";
import { isTorontoWeather, weatherFromReading, WEATHER_REFRESH_MS, type TorontoWeather, type WeatherMode } from "@/lib/current-weather";

export function useCurrentWeather(presentTime: boolean) {
  const [mode, setMode] = useState<WeatherMode>(presentTime ? "current" : "manual");
  const [weather, setWeather] = useState<WeatherState>(CLEAR_WEATHER);
  const [reading, setReading] = useState<TorontoWeather | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const previousPresent = useRef(presentTime);
  const current = useRef({ mode, presentTime });
  current.current = { mode, presentTime };

  useEffect(() => {
    if (previousPresent.current === presentTime) return;
    previousPresent.current = presentTime;
    const next = presentTime ? "current" : "manual";
    current.current.mode = next;
    setMode(next);
    if (presentTime && reading) setWeather(weatherFromReading(reading));
  }, [presentTime, reading]);

  const chooseMode = useCallback((next: WeatherMode) => {
    if (next === "current" && !current.current.presentTime) return;
    current.current.mode = next;
    setMode(next);
    if (next === "current" && reading) setWeather(weatherFromReading(reading));
  }, [reading]);

  const manualWeather = useCallback((next: WeatherState) => {
    current.current.mode = "manual";
    setMode("manual");
    setWeather(next);
  }, []);

  useEffect(() => {
    if (mode !== "current" || !presentTime) return;
    let disposed = false;
    let controller: AbortController | null = null;
    let lastAttempt = -Infinity;
    const refresh = async (force = false) => {
      if (document.hidden || disposed || controller || !force && Date.now() - lastAttempt < WEATHER_REFRESH_MS) return;
      lastAttempt = Date.now();
      controller = new AbortController();
      const request = controller;
      setStatus("loading");
      try {
        const response = await fetch("/api/weather", { signal: request.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Weather unavailable");
        const data: unknown = await response.json();
        if (!isTorontoWeather(data)) throw new Error("Invalid weather response");
        if (disposed || request.signal.aborted || current.current.mode !== "current" || !current.current.presentTime) return;
        setReading(data);
        setWeather(weatherFromReading(data));
        setStatus("ready");
      } catch {
        if (!disposed && !request.signal.aborted && current.current.mode === "current" && current.current.presentTime) setStatus("error");
      } finally { if (controller === request) controller = null; }
    };
    const visible = () => { if (!document.hidden) void refresh(); };
    const online = () => { if (!document.hidden) void refresh(true); };
    void refresh(true);
    const timer = window.setInterval(() => void refresh(), WEATHER_REFRESH_MS);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    return () => { disposed = true; controller?.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", visible); window.removeEventListener("online", online); };
  }, [mode, presentTime, retry]);

  return { weather, mode, reading, status, chooseMode, manualWeather, refresh: () => setRetry(value => value + 1) };
}
