import { NextResponse } from "next/server";
import { validateRunPayload } from "@/lib/run-payload";
import { DatabaseUnavailable, listRuns, saveRun } from "@/lib/runs-db";

export const runtime = "nodejs";

function failure(error: unknown) {
  if (error instanceof DatabaseUnavailable) return NextResponse.json({ error: error.message, configured: false }, { status: 503 });
  console.warn("Scenario database error:", error instanceof Error ? error.message : error);
  return NextResponse.json({ error: "The scenario database could not be reached. Please retry." }, { status: 502 });
}

export async function GET() {
  try {
    return NextResponse.json({ runs: await listRuns(20) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 400000) return NextResponse.json({ error: "Run is too large to save." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const checked = validateRunPayload(body);
  if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
  try {
    return NextResponse.json({ id: await saveRun(checked.run) }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
