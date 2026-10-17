export type WeatherRates = Readonly<{ rainMmPerHour: number; snowCmPerHour: number }>;
export const DRY_WEATHER: WeatherRates = { rainMmPerHour: 0, snowCmPerHour: 0 };
export const RAIN_ANCHORS = [[0, 0], [0.1, 8], [0.5, 20], [2.5, 45], [7.5, 75], [15, 100]] as const;
export const SNOW_ANCHORS = [[0, 0], [0.1, 10], [0.5, 30], [1, 50], [2.5, 80], [5, 100]] as const;

export type WeatherState = { rain: number; snow: number };

export const CLEAR_WEATHER: WeatherState = { rain: 0, snow: 0 };

export function weatherIntensity(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;
}

export function weatherLevel(value: number) {
  return value <= 0 ? "Off" : value < 35 ? "Light" : value < 70 ? "Moderate" : "Heavy";
}

export function weatherSummary(weather: WeatherState) {
  const parts = [weather.rain > 0 ? `${weatherLevel(weather.rain)} rain` : "", weather.snow > 0 ? `${weatherLevel(weather.snow)} snow` : ""].filter(Boolean);
  return parts.join(" · ") || "Clear weather";
}

export function weatherRatesFromIntensity(weather: WeatherState): WeatherRates {
  const rate = (intensity: number, anchors: readonly (readonly [number, number])[]) => {
    const value = weatherIntensity(intensity);
    for (let index = 1; index < anchors.length; index++) {
      const [upperRate, upperValue] = anchors[index];
      if (value > upperValue) continue;
      const [lowerRate, lowerValue] = anchors[index - 1];
      return lowerRate + (value - lowerValue) / (upperValue - lowerValue) * (upperRate - lowerRate);
    }
    return anchors[anchors.length - 1][0];
  };
  return { rainMmPerHour: rate(weather.rain, RAIN_ANCHORS), snowCmPerHour: rate(weather.snow, SNOW_ANCHORS) };
}

export function parseWeatherRates(value: unknown): WeatherRates {
  if (value === undefined) return DRY_WEATHER;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid weather rates");
  const { rainMmPerHour, snowCmPerHour } = value as Record<string, unknown>;
  if (typeof rainMmPerHour !== "number" || !Number.isFinite(rainMmPerHour) || rainMmPerHour < 0 || typeof snowCmPerHour !== "number" || !Number.isFinite(snowCmPerHour) || snowCmPerHour < 0) throw new Error("Invalid weather rates");
  return { rainMmPerHour, snowCmPerHour };
}
