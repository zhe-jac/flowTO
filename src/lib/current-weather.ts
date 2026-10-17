import { weatherIntensity, RAIN_ANCHORS, SNOW_ANCHORS, type WeatherRates, type WeatherState } from "./weather";

export const WEATHER_REFRESH_MS = 15 * 60 * 1000;
export const TORONTO_WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=43.6532&longitude=-79.3832&current=rain,showers,snowfall&timezone=America%2FToronto&timeformat=unixtime&forecast_days=1";
export type WeatherMode = "current" | "manual";
export type TorontoWeather = WeatherRates & { validAt: string; fetchedAt: string };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

export function parseCurrentWeather(payload: unknown, now = Date.now()): TorontoWeather {
  const root = record(payload), current = record(root.current), units = record(root.current_units);
  const { rain, showers, snowfall, interval, time } = current;
  if (!nonnegative(rain) || !nonnegative(showers) || !nonnegative(snowfall) || typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0 || interval > 3600 || typeof time !== "number" || !Number.isFinite(time)) throw new Error("Invalid current weather values");
  if (units.rain !== "mm" || units.showers !== "mm" || units.snowfall !== "cm" || units.time !== "unixtime" || units.interval !== "seconds") throw new Error("Unexpected current weather units");
  if (now - time * 1000 > 2 * 60 * 60 * 1000 || time * 1000 - now > WEATHER_REFRESH_MS) throw new Error("Current weather data is out of date");
  return { rainMmPerHour: (rain + showers) * 3600 / interval, snowCmPerHour: snowfall * 3600 / interval, validAt: new Date(time * 1000).toISOString(), fetchedAt: new Date(now).toISOString() };
}

export function isTorontoWeather(value: unknown): value is TorontoWeather {
  const data = record(value);
  return nonnegative(data.rainMmPerHour) && nonnegative(data.snowCmPerHour) && typeof data.validAt === "string" && Number.isFinite(Date.parse(data.validAt)) && typeof data.fetchedAt === "string" && Number.isFinite(Date.parse(data.fetchedAt));
}

function visualIntensity(rate: number, anchors: readonly (readonly [number, number])[]) {
  if (!(rate > 0)) return 0;
  for (let index = 1; index < anchors.length; index++) {
    const [upperRate, upperValue] = anchors[index];
    if (rate > upperRate) continue;
    const [lowerRate, lowerValue] = anchors[index - 1];
    return weatherIntensity(lowerValue + (rate - lowerRate) / (upperRate - lowerRate) * (upperValue - lowerValue));
  }
  return 100;
}

export function weatherFromReading(reading: TorontoWeather): WeatherState {
  return {
    rain: visualIntensity(reading.rainMmPerHour, RAIN_ANCHORS),
    snow: visualIntensity(reading.snowCmPerHour, SNOW_ANCHORS),
  };
}
