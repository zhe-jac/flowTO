import { NextResponse } from "next/server";
import { simulationJob } from "@/lib/traffic/simulation-jobs";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = simulationJob(id);
  return NextResponse.json(job ?? { error: "Simulation expired. Run it again." }, { status: job ? 200 : 404, headers: { "Cache-Control": "no-store" } });
}
