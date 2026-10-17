import { createTorontoWeatherService } from "@/lib/toronto-weather-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const currentWeather = createTorontoWeatherService();

export async function GET() {
  try {
    return Response.json(await currentWeather(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Current Toronto weather is unavailable. Try again." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
