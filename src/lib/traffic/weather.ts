import type { WeatherRates } from "../weather";

export const WEATHER_TRAFFIC_SOURCE = "https://ops.fhwa.dot.gov/weather/roadimpact.htm";
type Factors = Readonly<{ speed: number; capacity: number }>;
type Curve = readonly (readonly [number, number, number])[];
const RAIN_EXPRESSWAY: Curve = [[0, 0, 0], [0.5, 0.02, 0.04], [2.5, 0.05, 0.08], [7.5, 0.09, 0.14], [15, 0.12, 0.20]];
const RAIN_STREET: Curve = [[0, 0, 0], [0.5, 0.04, 0.02], [2.5, 0.10, 0.05], [7.5, 0.16, 0.10], [15, 0.20, 0.15]];
const SNOW_EXPRESSWAY: Curve = [[0, 0, 0], [0.1, 0.03, 0.02], [0.5, 0.08, 0.06], [1, 0.15, 0.12], [2.5, 0.23, 0.20], [5, 0.30, 0.25]];
const SNOW_STREET: Curve = [[0, 0, 0], [0.1, 0.04, 0.02], [0.5, 0.10, 0.05], [1, 0.20, 0.10], [2.5, 0.30, 0.16], [5, 0.35, 0.20]];
const cache = new WeakMap<WeatherRates, { expressway: Factors; street: Factors }>();

function reductions(rate: number, curve: Curve): [number, number] {
  if (!(rate > 0) || !Number.isFinite(rate)) return [0, 0];
  for (let index = 1; index < curve.length; index++) {
    const [upper, speed, capacity] = curve[index];
    if (rate > upper) continue;
    const [lower, lowerSpeed, lowerCapacity] = curve[index - 1];
    const t = (rate - lower) / (upper - lower);
    return [lowerSpeed + (speed - lowerSpeed) * t, lowerCapacity + (capacity - lowerCapacity) * t];
  }
  const last = curve[curve.length - 1];
  return [last[1], last[2]];
}

export function weatherFactors(cls: string, weather: WeatherRates): Factors {
  let factors = cache.get(weather);
  if (!factors) {
    const combine = (rainCurve: Curve, snowCurve: Curve): Factors => {
      const rain = reductions(weather.rainMmPerHour, rainCurve);
      const snow = reductions(weather.snowCmPerHour, snowCurve);
      return { speed: 1 - Math.max(rain[0], snow[0]), capacity: 1 - Math.max(rain[1], snow[1]) };
    };
    factors = { expressway: combine(RAIN_EXPRESSWAY, SNOW_EXPRESSWAY), street: combine(RAIN_STREET, SNOW_STREET) };
    cache.set(weather, factors);
  }
  return cls === "Expressway" || cls === "Expressway Ramp" ? factors.expressway : factors.street;
}
