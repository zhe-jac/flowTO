"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WeatherRates } from "@/lib/weather";
import type { Disruption } from "@/lib/disruptions";
import type { DayType } from "@/lib/traffic/types";
import type { SimulationJob, SimulationResult } from "@/lib/traffic/simulation-types";
import { sampleSimulation } from "@/lib/traffic/simulation-plan";
import { SimulationHistory } from "@/lib/traffic/simulation-history";
import type { DisruptionPlacement } from "@/lib/traffic/scenario-timing";

export function useRerouting(items: Disruption[], _day: DayType, minutes: number, weather: WeatherRates, date = "2026-10-18", placedAt?: ReadonlyMap<string, DisruptionPlacement>) {
  const [result, setResult] = useState<{ key: string; data: SimulationResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [generation, setGeneration] = useState(0);
  const history = useRef<SimulationHistory | null>(null);
  history.current ??= new SimulationHistory();
  const anchor = useRef({ date, minute: Math.floor(minutes / 60) * 60 });
  if (anchor.current.date !== date || minutes < anchor.current.minute - 30 || minutes >= anchor.current.minute + 115) anchor.current = { date, minute: Math.floor(minutes / 60) * 60 };
  const operations = history.current.update(items, date, minutes, anchor.current.minute, placedAt);
  const key = JSON.stringify({ items: operations, date, minutes: anchor.current.minute, weather, generation });
  const clockKey = Math.floor(minutes * 2) / 2;

  useEffect(() => {
    const reset = () => { history.current?.reset(); setResult(null); setError(null); setGeneration(value => value + 1); };
    window.addEventListener("traffic-scenario-reset", reset);
    return () => window.removeEventListener("traffic-scenario-reset", reset);
  }, []);

  useEffect(() => {
    setError(null);
    if (!JSON.parse(key).items.length) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async (id?: string) => {
      try {
        const response = await fetch(id ? `/api/traffic/simulations/${encodeURIComponent(id)}` : "/api/traffic/simulations", id ? { signal: controller.signal } : { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal });
        const job = await response.json() as SimulationJob & { error?: string };
        if (!response.ok) throw new Error(job.error ?? "Traffic simulation failed. Please retry.");
        if (controller.signal.aborted) return;
        if (job.status === "failed") throw new Error(job.error ?? "Traffic simulation failed.");
        if (job.status === "complete" && job.result) setResult({ key, data: job.result });
        else timer = setTimeout(() => { void poll(job.id); }, 500);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Traffic simulation failed.");
      }
    };
    timer = setTimeout(() => { void poll(); }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, retry]);

  const plan = useMemo(() => {
    if (!operations.length || result?.key !== key) return null;
    const sampled = sampleSimulation(result.data, clockKey);
    sampled.simulation!.runKey = key;
    return sampled;
  }, [result, key, clockKey, operations.length]);
  // The full run (every frame) for the results dashboard; null while a new scenario is simulating.
  const run = operations.length && result?.key === key ? result.data : null;
  return { plan, run, error, loading: operations.length > 0 && result?.key !== key && !error, retry: () => setRetry(n => n + 1) };
}
