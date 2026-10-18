import { NextResponse } from "next/server";
import { DatabaseUnavailable, hourlyPattern } from "@/lib/runs-db";

export const runtime = "nodejs";

/** Cross-run analysis: average extra vehicles on the roads by hour of day across every saved run. */
export async function GET() {
  try {
    return NextResponse.json({ hours: await hourlyPattern() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DatabaseUnavailable) return NextResponse.json({ error: error.message, configured: false }, { status: 503 });
    console.warn("Scenario database error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "The scenario database could not be reached." }, { status: 502 });
  }
}
