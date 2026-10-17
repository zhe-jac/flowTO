"use client";
import { useEffect, useState } from "react";
import type { Disruption } from "@/lib/disruptions";
import type { DayType } from "@/lib/traffic/types";
import type { ReroutingPlan } from "@/lib/traffic/rerouting";

export function useRerouting(items: Disruption[], day: DayType, minutes: number) {
  const [result, setResult] = useState<{ key: string; plan: ReroutingPlan } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const key = JSON.stringify({ items, day, minutes: Math.floor(minutes / 60) * 60 });
  useEffect(() => {
    setError(null);
    if (!items.length) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/traffic/reroute", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 400 ? "This scenario could not be analyzed (maximum 20 disruptions)." : "Traffic analysis failed. Please retry.");
        const plan = await response.json() as ReroutingPlan;
        if (!controller.signal.aborted) setResult({ key, plan });
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Traffic analysis failed."); }
    }, 700);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, retry, items.length]);
  return { plan: items.length && result?.key === key ? result.plan : null, error, loading: items.length > 0 && result?.key !== key && !error, retry: () => setRetry(n => n + 1) };
}
