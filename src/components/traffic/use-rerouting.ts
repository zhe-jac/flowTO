"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { WeatherRates } from "@/lib/weather";
import type { Disruption } from "@/lib/disruptions";
import type { DayType } from "@/lib/traffic/types";
import { requestSimulation } from "@/lib/traffic/simulation-client";
import { sampleSimulation } from "@/lib/traffic/simulation-plan";
import { SimulationCache } from "@/lib/traffic/simulation-cache";
import { SimulationHistory } from "@/lib/traffic/simulation-history";
import type { DisruptionPlacement } from "@/lib/traffic/scenario-timing";

export function useRerouting(items: Disruption[], _day: DayType, minutes: number, weather: WeatherRates, date = "2026-10-18", placedAt?: ReadonlyMap<string, DisruptionPlacement>) {
  const [, refresh] = useState(0);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const [generation, setGeneration] = useState(0);
  const client = useRef<{ clientId: string; revision: number } | null>(null);
  const history = useRef<SimulationHistory | null>(null);
  const cache = useRef<SimulationCache | null>(null);
  history.current ??= new SimulationHistory();
  cache.current ??= new SimulationCache();
  const anchor = Math.floor(minutes / 120) * 120;
  const operations = history.current.update(items, date, minutes, anchor, placedAt);
  const scenario = JSON.stringify({ history: history.current.scenarioKey(), weather, generation });
  cache.current.useScenario(scenario);
  const clockKey = Math.floor(minutes * 2) / 2;
  const cached = cache.current.find(date, clockKey);
  const body = !cached && operations.length ? JSON.stringify({ items: operations, date, minutes: anchor, weather, generation }) : null;
  const requestKey = body ? JSON.stringify([scenario, body]) : null;
  const error = failure?.key === requestKey ? failure.message : null;

  useEffect(() => {
    const reset = () => { history.current?.reset(); setFailure(null); setGeneration(value => value + 1); };
    window.addEventListener("traffic-scenario-reset", reset);
    return () => window.removeEventListener("traffic-scenario-reset", reset);
  }, []);

  useEffect(() => {
    setFailure(null);
    if (!body || !requestKey) return;
    client.current ??= { clientId: crypto.randomUUID(), revision: 0 };
    const owner = { clientId: client.current.clientId, revision: ++client.current.revision };
    const controller = new AbortController();
    let submitted = false;
    const run = async () => {
      submitted = true;
      try {
        const data = await requestSimulation(JSON.stringify({ ...JSON.parse(body), ...owner }), controller.signal);
        if (!controller.signal.aborted && cache.current?.store(scenario, requestKey, JSON.parse(body).date, data)) refresh(value => value + 1);
      } catch (cause) {
        if (!controller.signal.aborted) setFailure({ key: requestKey, message: cause instanceof Error ? cause.message : "Traffic simulation failed." });
      }
    };
    const timer = setTimeout(() => { void run(); }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (submitted) void fetch("/api/traffic/simulations", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(owner), keepalive: true }).catch(() => {});
    };
  }, [body, requestKey, scenario, retry]);

  const data = cached?.data, runKey = cached?.key, sampleMinute = cached?.minute;
  const plan = useMemo(() => {
    if (!data || !runKey || sampleMinute === undefined) return null;
    const sampled = sampleSimulation(data, sampleMinute);
    sampled.simulation!.runKey = runKey;
    sampled.simulation!.minute = clockKey;
    return sampled;
  }, [data, runKey, sampleMinute, clockKey]);
  return { plan, error, loading: !!body && !error, retry: () => { setFailure(null); setRetry(n => n + 1); } };
}
