import { parseCurrentWeather, TORONTO_WEATHER_URL, WEATHER_REFRESH_MS, type TorontoWeather } from "./current-weather";

type WeatherFetch = (url: string, options: RequestInit) => Promise<Response>;

export function createTorontoWeatherService(fetcher: WeatherFetch = fetch, now = Date.now) {
  let cached: TorontoWeather | null = null;
  let cachedAt = -Infinity;
  let pending: Promise<TorontoWeather> | null = null;
  return async () => {
    if (cached && now() - cachedAt < WEATHER_REFRESH_MS) return cached;
    if (pending) return pending;
    pending = (async () => {
      const response = await fetcher(TORONTO_WEATHER_URL, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("Weather provider unavailable");
      const reading = parseCurrentWeather(await response.json(), now());
      cached = reading;
      cachedAt = now();
      return reading;
    })();
    try { return await pending; }
    finally { pending = null; }
  };
}
