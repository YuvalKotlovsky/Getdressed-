import type { Weather, WeatherPoint } from '../types';
import { dateKey } from '../logic/dates';

export interface City {
  id: string;
  name: string; // Hebrew
  lat: number;
  lon: number;
  /** climate fallback: annual mean °C, seasonal amplitude, day/night swing (northern hemisphere, warmest ~1 Aug) */
  mean: number;
  amp: number;
  swing: number;
}

export const CITIES: City[] = [
  { id: 'tlv', name: 'תל אביב', lat: 32.08, lon: 34.78, mean: 21, amp: 6.5, swing: 5 },
  { id: 'jlm', name: 'ירושלים', lat: 31.77, lon: 35.21, mean: 17, amp: 8, swing: 8 },
  { id: 'hfa', name: 'חיפה', lat: 32.79, lon: 34.99, mean: 20.5, amp: 7, swing: 5 },
  { id: 'bsh', name: 'באר שבע', lat: 31.25, lon: 34.79, mean: 20, amp: 9, swing: 11 },
  { id: 'eil', name: 'אילת', lat: 29.56, lon: 34.95, mean: 25.5, amp: 9.5, swing: 11 },
  { id: 'tib', name: 'טבריה', lat: 32.79, lon: 35.53, mean: 23, amp: 8, swing: 8 },
  { id: 'lon', name: 'לונדון', lat: 51.5, lon: -0.12, mean: 11.5, amp: 6.5, swing: 5 },
  { id: 'par', name: 'פריז', lat: 48.85, lon: 2.35, mean: 12, amp: 8, swing: 7 },
  { id: 'nyc', name: 'ניו יורק', lat: 40.71, lon: -74, mean: 13, amp: 12, swing: 7 },
];
export const DEFAULT_CITY = 'tlv';
export const cityById = (id?: string): City => CITIES.find((c) => c.id === id) ?? CITIES[0];

export const bandOf = (temp: number): Weather => (temp >= 27 ? 'hot' : temp <= 16 ? 'cold' : 'mild');
/** Representative temperature for a manual override. */
export const OVERRIDE_TEMP: Record<Weather, number> = { hot: 31, mild: 21, cold: 10 };

/** Typical temperature for a city, date and hour when no forecast is available. */
export function seasonalTemp(city: City, ms: number): number {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), 0, 0).getTime();
  const doy = Math.floor((ms - start) / 86400000);
  const hour = d.getHours() + d.getMinutes() / 60;
  const seasonal = city.mean + city.amp * Math.cos((2 * Math.PI * (doy - 213)) / 365);
  const diurnal = (city.swing / 2) * Math.cos((2 * Math.PI * (hour - 15)) / 24);
  return Math.round((seasonal + diurnal) * 10) / 10;
}

export interface Forecast { times: number[]; temps: number[] }

/** Parses an Open-Meteo hourly response (timezone=auto -> local ISO times). */
export function parseOpenMeteo(json: any): Forecast | null {
  const t: string[] | undefined = json?.hourly?.time;
  const v: (number | null)[] | undefined = json?.hourly?.temperature_2m;
  if (!Array.isArray(t) || !Array.isArray(v) || t.length === 0 || t.length !== v.length) return null;
  const times: number[] = [];
  const temps: number[] = [];
  t.forEach((s, i) => {
    const ms = new Date(s).getTime();
    if (v[i] != null && Number.isFinite(ms)) { times.push(ms); temps.push(v[i] as number); }
  });
  return times.length ? { times, temps } : null;
}

export async function fetchForecast(city: City, fetchImpl: typeof fetch = fetch, timeoutMs = 6000): Promise<Forecast | null> {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m&forecast_days=8&timezone=auto`;
    const res = await fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
    if (timer) clearTimeout(timer);
    if (!res.ok) return null;
    return parseOpenMeteo(await res.json());
  } catch {
    return null;
  }
}

export type WeatherSource = (ms: number) => WeatherPoint;

export function makeWeatherSource(opts: { city: City; forecast: Forecast | null; overrides?: Record<string, Weather> }): WeatherSource {
  const { city, forecast, overrides = {} } = opts;
  return (ms) => {
    const o = overrides[dateKey(ms)];
    if (o) return { temp: OVERRIDE_TEMP[o], band: o, source: 'manual' };
    if (forecast) {
      let best = -1;
      let bestD = Infinity;
      forecast.times.forEach((t, i) => { const d = Math.abs(t - ms); if (d < bestD) { bestD = d; best = i; } });
      if (best >= 0 && bestD <= 90 * 60000) {
        const temp = Math.round(forecast.temps[best]);
        return { temp, band: bandOf(temp), source: 'forecast' };
      }
    }
    const temp = seasonalTemp(city, ms);
    return { temp, band: bandOf(temp), source: 'season' };
  };
}
