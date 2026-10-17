import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { validateDisruption, type Disruption } from "@/lib/disruptions";
import { solveTraffic } from "@/lib/traffic/solver";
import type { TrafficData } from "@/lib/traffic/types";

export const runtime = "nodejs";
export const maxDuration = 60;
let traffic: Promise<TrafficData> | undefined;
const cache = new Map<string, { expires: number; plan: unknown }>();
let inFlight = 0;
export async function POST(request: Request) {
  let items: Disruption[], day: "weekday" | "weekend", minutes: number;
  try {
    const text = await request.text();
    if (text.length > 40000) throw new Error();
    const body = JSON.parse(text);
    if (!Array.isArray(body.items) || body.items.length > 20 || !["weekday", "weekend"].includes(body.day) || !Number.isFinite(body.minutes) || body.minutes < 0 || body.minutes >= 1440) throw new Error();
    for (const item of body.items) {
      if (!item || typeof item.id !== "string" || item.id.length > 100 || !["event", "closure", "accident", "construction"].includes(item.kind) || !Array.isArray(item.position) || item.position.length !== 2 || item.position.some((n: unknown) => typeof n !== "number" || !Number.isFinite(n)) || typeof item.startsAt !== "string" || typeof item.endsAt !== "string" || item.timeZone !== "America/Toronto" || (item.kind !== "event" && !["full-closure", "lane-reduction"].includes(item.restriction)) || validateDisruption(item)) throw new Error();
    }
    if (new Set(body.items.map((i: Disruption) => i.id)).size !== body.items.length) throw new Error();
    ({ items, day, minutes } = body);
  } catch { return NextResponse.json({ error: "Invalid disruption scenario (maximum 20 items)." }, { status: 400 }); }
  const key = JSON.stringify({ items, day, minutes });
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return NextResponse.json(cached.plan);
  if (inFlight >= 2) return NextResponse.json({ error: "Traffic analysis is busy. Please retry." }, { status: 429 });
  inFlight++;
  try {
    const data: TrafficData = await (traffic ??= readFile(`${process.cwd()}/public/data/traffic.json`, "utf8").then(text => JSON.parse(text) as TrafficData));
    const knownRoads = new Set(data.segments.map(s => s.id));
    if (items.some(item => item.kind !== "event" && !knownRoads.has(item.roadId))) return NextResponse.json({ error: "A disruption references an unknown road." }, { status: 400 });
    const plan = solveTraffic(data, items, day, minutes);
    if (cache.size >= 50) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 300000, plan });
    return NextResponse.json(plan);
  } finally { inFlight--; }
}
