import { NextResponse } from "next/server";
import { validateDisruption, type Disruption } from "@/lib/disruptions";
import { parseWeatherRates } from "@/lib/weather";
import { validSimulationDate } from "@/lib/traffic/simulation-date";
import { validRoadExtent } from "@/lib/road-extent";
import { trafficData } from "@/lib/traffic/server-data";
import { prepareSimulation } from "@/lib/traffic/simulation-network";
import { beginSimulation, cancelSimulation, startSimulation, trafficTopology } from "@/lib/traffic/simulation-jobs";
import { parseSimulationOwner } from "@/lib/traffic/simulation-queue";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 100000) throw new Error("Scenario is too large.");
    const body = JSON.parse(raw);
    if (!validSimulationDate(body.date) || !Number.isFinite(body.minutes) || body.minutes < 0 || body.minutes >= 1440 || !Array.isArray(body.items) || !body.items.length || body.items.length > 40) throw new Error("Choose a valid simulation date, time and up to 40 current or recent disruptions.");
    for (const item of body.items as Disruption[]) {
      if (!item || typeof item.id !== "string" || item.id.length > 100 || !["event", "construction", "closure", "accident"].includes(item.kind) || !Array.isArray(item.position) || item.position.length !== 2 || item.position.some(n => !Number.isFinite(n)) || typeof item.startsAt !== "string" || typeof item.endsAt !== "string" || item.timeZone !== "America/Toronto" || item.kind !== "event" && !["full-closure", "lane-reduction"].includes(item.restriction) || validateDisruption(item)) throw new Error("A disruption has invalid location, timing or restriction settings.");
    }
    if (new Set(body.items.map((item: Disruption) => item.id)).size !== body.items.length) throw new Error("Disruption identifiers must be unique.");
    const weather = parseWeatherRates(body.weather);
    const owner = body.clientId === undefined && body.revision === undefined ? undefined : parseSimulationOwner(body);
    if (owner && !beginSimulation(owner)) throw new Error("Simulation request was superseded.");
    const [data, topology] = await Promise.all([trafficData(), trafficTopology()]);
    const roads = new Map(data.segments.map(road => [road.id, road.coords]));
    if (body.items.some((item: Disruption) => item.kind !== "event" && !validRoadExtent(item, id => roads.get(id)))) throw new Error("Choose a connected road extent.");
    const job = startSimulation(prepareSimulation(data, { ...body, weather }, topology), owner);
    return NextResponse.json(job, { status: job.status === "complete" ? 200 : 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Simulation request could not be processed.";
    return NextResponse.json({ error: message }, { status: message.includes("busy") ? 429 : message.includes("superseded") ? 409 : 400, headers: { "Cache-Control": "no-store", ...(message.includes("busy") ? { "Retry-After": "1" } : {}) } });
  }
}

export async function DELETE(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 1000) throw new Error("Invalid simulation request identifier.");
    cancelSimulation(parseSimulationOwner(JSON.parse(raw)));
    return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Simulation could not be cancelled." }, { status: 400 });
  }
}
