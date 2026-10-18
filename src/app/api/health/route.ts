import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await Promise.all([
      access(path.join(process.cwd(), "src/lib/traffic/simulation-worker.mjs"), constants.R_OK),
      access(path.join(process.cwd(), "src/lib/traffic/simulation-engine.mjs"), constants.R_OK),
      access(path.join(process.cwd(), "public/data/traffic.json"), constants.R_OK),
      access(path.join(process.cwd(), "public/data/traffic-topology.json"), constants.R_OK),
      access(path.join(process.cwd(), "public/data/downtown-roads.geojson"), constants.R_OK),
    ]);
    return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "error", error: "Required simulation files are unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
