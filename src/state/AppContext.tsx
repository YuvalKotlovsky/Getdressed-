import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AppData, CalEvent, Choice, DayPlan, Item, Mode, ModeData, Occasion, Weather } from '../types';
import { cityById, fetchForecast, makeWeatherSource, type City, type Forecast } from '../weather/weather';
import { freshData, loadData, saveData } from '../storage/persist';
import { DemoCalendarProvider, ManualCalendarProvider, type CalendarProvider } from '../calendar/provider';
import { buildWeek } from '../logic/week';
import { choiceKey } from '../logic/recommend';
import { demoModeData } from '../data/demo';

interface Ctx {
  ready: boolean;
  mode: Mode;
  setMode(m: Mode): void;
  data: ModeData;
  week: DayPlan[];
  refreshing: boolean;
  refresh(): Promise<void>;
  city: City;
  forecastStatus: 'loading' | 'live' | 'unavailable';
  weatherOverride: Record<string, Weather>;
  setCity(id: string): void;
  setWeatherOverride(dKey: string, w: Weather | null): void;
  nextLook(dKey: string, entryKey: string): void;
  confirmLook(dKey: string, entryKey: string, itemIds: string[], worn: boolean): void;
  clearSaved(dKey: string, entryKey: string): void;
  setOccasion(eventId: string, o: Occasion): void;
  addManualEvent(e: CalEvent): void;
  removeManualEvent(id: string): void;
  moveDemoEvent(id: string, delta: number): void;
  saveItem(it: Item): void;
  deleteItem(id: string): void;
  resetDemo(): void;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [all, setAll] = useState<AppData>(freshData());
  const [ready, setReady] = useState(false);
  const [week, setWeek] = useState<DayPlan[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastStatus, setForecastStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const allRef = useRef(all);
  allRef.current = all;

  useEffect(() => { loadData().then((d) => { setAll(d); setReady(true); }); }, []);
  useEffect(() => { if (ready) saveData(all); }, [all, ready]);

  const mode = all.mode;
  const data = all[mode];

  const provider: CalendarProvider = useMemo(
    () => (mode === 'demo' ? new DemoCalendarProvider() : new ManualCalendarProvider(() => allRef.current.mine.manualEvents)),
    [mode],
  );

  const city = cityById(all.settings?.cityId);
  const weatherOverride = all.settings?.weatherOverride ?? {};

  // Forecast for the chosen city; refreshed on open/foreground/pull-to-refresh. Falls back to the local season.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setForecastStatus('loading');
    fetchForecast(city).then((f) => { if (live) { setForecast(f); setForecastStatus(f ? 'live' : 'unavailable'); } });
    return () => { live = false; };
  }, [ready, city, tick]);

  const weatherSource = useMemo(() => makeWeatherSource({ city, forecast, overrides: weatherOverride }), [city, forecast, weatherOverride]);

  // Re-plan whenever data changes or a refresh is requested (app open/foreground/pull-to-refresh).
  useEffect(() => {
    if (!ready) return;
    let live = true;
    buildWeek(provider, data, new Date(), weatherSource).then((w) => { if (live) { setWeek(w); setRefreshing(false); } });
    return () => { live = false; };
  }, [ready, provider, data, tick, weatherSource]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') setTick((t) => t + 1); });
    return () => sub.remove();
  }, []);

  const refresh = useCallback(async () => { setRefreshing(true); setTick((t) => t + 1); }, []);

  const patch = useCallback((fn: (d: ModeData) => ModeData) => {
    setAll((a) => ({ ...a, [a.mode]: fn(a[a.mode]) }));
  }, []);

  const setChoice = (d: ModeData, k: string, fn: (c: Choice) => Choice): ModeData => ({
    ...d, choices: { ...d.choices, [k]: fn(d.choices[k] ?? { variant: 0 }) },
  });

  const value: Ctx = {
    ready, mode, data, week, refreshing, refresh, city, forecastStatus, weatherOverride,
    setCity: (id) => setAll((a) => ({ ...a, settings: { cityId: id, weatherOverride: a.settings?.weatherOverride ?? {} } })),
    setWeatherOverride: (dk, w) => setAll((a) => {
      const cur = { ...(a.settings?.weatherOverride ?? {}) };
      if (w) cur[dk] = w; else delete cur[dk];
      return { ...a, settings: { cityId: a.settings?.cityId ?? city.id, weatherOverride: cur } };
    }),
    setMode: (m) => setAll((a) => ({ ...a, mode: m })),
    nextLook: (dk, ek) => patch((d) => setChoice(d, choiceKey(dk, ek), (c) => ({ variant: c.variant + 1 }))),
    confirmLook: (dk, ek, ids, worn) =>
      patch((d) => {
        const k = choiceKey(dk, ek);
        const next = setChoice(d, k, (c) => ({ ...c, savedItemIds: ids, worn }));
        return worn ? { ...next, history: [...next.history.filter((h) => !(h.dateKey === dk && h.itemIds.join() === ids.join())), { dateKey: dk, itemIds: ids }] } : next;
      }),
    clearSaved: (dk, ek) => patch((d) => setChoice(d, choiceKey(dk, ek), (c) => ({ variant: c.variant + 1, worn: false }))),
    setOccasion: (id, o) => patch((d) => ({ ...d, occasionOverrides: { ...d.occasionOverrides, [id]: o } })),
    addManualEvent: (e) => patch((d) => ({ ...d, manualEvents: [...d.manualEvents, e] })),
    removeManualEvent: (id) => patch((d) => ({ ...d, manualEvents: d.manualEvents.filter((e) => e.id !== id) })),
    moveDemoEvent: (id, delta) => patch((d) => ({ ...d, eventMoves: { ...d.eventMoves, [id]: (d.eventMoves[id] ?? 0) + delta } })),
    saveItem: (it) => patch((d) => ({ ...d, items: d.items.some((x) => x.id === it.id) ? d.items.map((x) => (x.id === it.id ? it : x)) : [...d.items, it] })),
    deleteItem: (id) => patch((d) => ({ ...d, items: d.items.filter((x) => x.id !== id) })),
    resetDemo: () => setAll((a) => ({ ...a, demo: demoModeData() })),
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
