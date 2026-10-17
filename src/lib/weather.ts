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
