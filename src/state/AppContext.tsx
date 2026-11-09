import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { Settings, AppData, CalEvent, Choice, DayPlan, Item, ModeData, Occasion, StaleEdit, Weather } from '../types';
import { cityById, fetchForecast, makeWeatherSource, type City, type Forecast } from '../weather/weather';
import { clearAccountCache, loadData, readPhotoBytes, saveData } from '../storage/persist';
import { CompositeCalendarProvider, ManualCalendarProvider, type CalendarProvider } from '../calendar/provider';
import { NativeCalendarProvider, nativeCalendarSupported } from '../calendar/native';
import { buildWeek } from '../logic/week';
import { choiceKey } from '../logic/recommend';
import { emptyAppData } from '../cloud/scope';
import { getSupabase, supabaseApi } from '../cloud/client';
import { applyFlushResult, applyPull, applyRestoreStale, backoffMs, flushOp, planDelete, planSave, pullAll, type CloudApi, type FlushResult } from '../cloud/engine';
import { newUuid } from '../cloud/uuid';
import { useAuth } from '../auth/AuthContext';

interface Ctx {
  ready: boolean;
  /** signed-in account (the cache and all data belong to it) */
  accountEmail: string;
  data: ModeData;
  week: DayPlan[];
  refreshing: boolean;
  refresh(): Promise<void>;
  city: City;
  forecastStatus: 'loading' | 'live' | 'unavailable';
  weatherOverride: Record<string, Weather>;
  setCity(id: string): void;
  setWeatherOverride(dKey: string, w: Weather | null): void;
  settings: Settings;
  updateSettings(patch: Partial<Settings>): void;
  nextLook(dKey: string, entryKey: string): void;
  confirmLook(dKey: string, entryKey: string, itemIds: string[], worn: boolean): void;
  clearSaved(dKey: string, entryKey: string): void;
  setOccasion(eventId: string, o: Occasion): void;
  addManualEvent(e: CalEvent): void;
  removeManualEvent(id: string): void;
  saveItem(it: Item): void;
  deleteItem(id: string): void;
  /** ids of items whose latest change has NOT reached the cloud yet */
  pendingIds: string[];
  syncing: boolean;
  /** last sync attempt could not reach the server */
  offline: boolean;
  /** this device could not store the local cache */
  localSaveFailed: boolean;
  /** edits rejected because the item was deleted on another device (delete wins) */
  staleEdits: StaleEdit[];
  /** keep the rejected edit by saving it as a NEW item */
  restoreStaleEdit(id: string): void;
  dismissStaleEdit(id: string): void;
  retrySync(): void;
  /** signed URL (1h, cached in memory) or local copy for an item's photo */
  resolvePhoto(item: Item): Promise<string | undefined>;
  /** wipes this account's cache from the device, then signs out */
  signOutAccount(): Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider missing');
  return c;
};

const PHOTO_TTL = 3600;

export function AppProvider({ userId, email, children }: { userId: string; email: string; children: React.ReactNode }) {
  const auth = useAuth();
  const api: CloudApi | null = useMemo(() => { const sb = getSupabase(); return sb ? supabaseApi(sb, userId) : null; }, [userId]);
  const [all, setAll] = useState<AppData>(() => emptyAppData(userId));
  const [ready, setReady] = useState(false);
  const [week, setWeek] = useState<DayPlan[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastStatus, setForecastStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const allRef = useRef(all);
  allRef.current = all;
  const wiped = useRef(false);
  const flushing = useRef(false);
  const failStreak = useRef(0);
  const rerun = useRef(false);
  const alive = useRef(true);
  const photoCache = useRef(new Map<string, { exp: number; url: Promise<string> }>());

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { loadData(userId).then((d) => { if (!alive.current) return; setAll(d); setReady(true); }); }, [userId]);
  useEffect(() => {
    if (!ready || wiped.current) return;
    saveData(all).then((ok) => { if (alive.current) setLocalSaveFailed(!ok); });
  }, [all, ready]);

  const data = all.data;
  const pendingIds = Object.keys(all.sync.pending);
  const pendingKey = pendingIds.join(',');

  // Push unsent changes, then pull what other devices changed. One run at a time.
  const flush = useCallback(async () => {
    if (!api || wiped.current) return;
    if (flushing.current) { rerun.current = true; return; } // a change arrived mid-sync: run again afterwards
    flushing.current = true; setSyncing(true);
    let failed = false;
    try {
      // Remove objects of edits that were dropped (persisted list, so it also survives a restart).
      const stale = allRef.current.sync.discard ?? [];
      if (stale.length) {
        await api.removePhotos(stale).then(() => {
          setAll((a) => ({ ...a, sync: { ...a.sync, discard: (a.sync.discard ?? []).filter((p) => !stale.includes(p)) } }));
        }).catch(() => {}); // still listed; retried on the next run
      }
      for (const id of Object.keys(allRef.current.sync.pending)) {
        const op = allRef.current.sync.pending[id];
        const item = allRef.current.data.items.find((i) => i.id === id);
        const res: FlushResult = await flushOp(api, userId, id, op, item, readPhotoBytes);
        if (!alive.current || wiped.current) return;
        setAll((a) => {
          if (a.sync.pending[id] !== op) { rerun.current = true; return a; } // edited again while sending: run once more (idempotent)
          const s = applyFlushResult({ items: a.data.items, pending: a.sync.pending, conflicts: a.conflicts, discard: a.sync.discard ?? [] }, id, op, res, new Date().toISOString());
          return { ...a, data: { ...a.data, items: s.items }, sync: { ...a.sync, pending: s.pending }, conflicts: s.conflicts };
        });
        if (!res.done) failed = true;
      }
      const { rows, cursor } = await pullAll(api, allRef.current.sync.cursor);
      if (!alive.current || wiped.current) return;
      setAll((a) => {
        const s = applyPull({ items: a.data.items, pending: a.sync.pending, conflicts: a.conflicts, discard: a.sync.discard ?? [] }, rows, new Date().toISOString());
        if (s.discard.length) rerun.current = true; // removed at the start of the next run
        return { ...a, data: { ...a.data, items: s.items }, sync: { ...a.sync, pending: s.pending, cursor, discard: s.discard }, conflicts: s.conflicts };
      });
      setOffline(false);
    } catch {
      failed = true; // could not reach the server
      if (alive.current) setOffline(true);
    } finally {
      flushing.current = false;
      failStreak.current = failed ? failStreak.current + 1 : 0;
      const again = rerun.current; rerun.current = false;
      if (alive.current) { setSyncing(false); if (failed || again) setSyncTick((t) => t + 1); }
    }
  }, [api, userId]);

  // Start on load, after local changes, and (with backoff) while anything is still unsent.
  useEffect(() => {
    if (!ready || !api) return;
    const t = setTimeout(() => { flush(); }, failStreak.current > 0 ? backoffMs(failStreak.current) : 300);
    return () => clearTimeout(t);
  }, [ready, api, flush, pendingKey, tick, syncTick]);

  const calendarConnected = !!all.settings?.calendarConnected;
  const calendarKey = (all.settings?.calendarIds ?? []).join(',');
  const provider: CalendarProvider = useMemo(
    () => {
      const parts: CalendarProvider[] = [new ManualCalendarProvider(() => allRef.current.data.manualEvents)];
      if (nativeCalendarSupported && calendarConnected) parts.push(new NativeCalendarProvider(() => allRef.current.settings?.calendarIds ?? []));
      return new CompositeCalendarProvider(parts);
    },
    [calendarConnected, calendarKey],
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
    setAll((a) => ({ ...a, data: fn(a.data) }));
  }, []);

  const resolvePhoto = useCallback(async (item: Item): Promise<string | undefined> => {
    if (item.photoUri) return item.photoUri;
    if (!item.photoPath || !api) return undefined;
    const hit = photoCache.current.get(item.photoPath);
    if (hit && hit.exp > Date.now()) return hit.url.catch(() => undefined);
    const url = api.signedUrl(item.photoPath, PHOTO_TTL);
    photoCache.current.set(item.photoPath, { exp: Date.now() + (PHOTO_TTL - 600) * 1000, url });
    return url.catch(() => { photoCache.current.delete(item.photoPath!); return undefined; });
  }, [api]);

  const setChoice = (d: ModeData, k: string, fn: (c: Choice) => Choice): ModeData => ({
    ...d, choices: { ...d.choices, [k]: fn(d.choices[k] ?? { variant: 0 }) },
  });

  const value: Ctx = {
    ready, accountEmail: email, data, week, refreshing, refresh, city, forecastStatus, weatherOverride,
    settings: all.settings ?? { cityId: city.id, weatherOverride: {} },
    updateSettings: (patch) => setAll((a) => ({ ...a, settings: { cityId: a.settings?.cityId ?? city.id, weatherOverride: a.settings?.weatherOverride ?? {}, ...a.settings, ...patch } })),
    setCity: (id) => setAll((a) => ({ ...a, settings: { weatherOverride: {}, ...a.settings, cityId: id } })),
    setWeatherOverride: (dk, w) => setAll((a) => {
      const cur = { ...(a.settings?.weatherOverride ?? {}) };
      if (w) cur[dk] = w; else delete cur[dk];
      return { ...a, settings: { ...a.settings, cityId: a.settings?.cityId ?? city.id, weatherOverride: cur } };
    }),
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
    saveItem: (it) => { if (flushing.current) rerun.current = true; setAll((a) => {
      const prev = a.data.items.find((x) => x.id === it.id);
      const items = prev ? a.data.items.map((x) => (x.id === it.id ? it : x)) : [...a.data.items, it];
      return { ...a, data: { ...a.data, items }, sync: { ...a.sync, pending: { ...a.sync.pending, [it.id]: planSave(prev, it, a.sync.pending[it.id], newUuid) } } };
    }); },
    deleteItem: (id) => { if (flushing.current) rerun.current = true; setAll((a) => {
      const prev = a.data.items.find((x) => x.id === id);
      return { ...a, data: { ...a.data, items: a.data.items.filter((x) => x.id !== id) }, sync: { ...a.sync, pending: { ...a.sync.pending, [id]: planDelete(prev, a.sync.pending[id]) } } };
    }); },
    pendingIds, syncing, offline, localSaveFailed, resolvePhoto,
    staleEdits: all.conflicts,
    dismissStaleEdit: (id) => setAll((a) => ({ ...a, conflicts: a.conflicts.filter((c) => c.id !== id) })),
    restoreStaleEdit: (id) => setAll((a) => {
      const s = applyRestoreStale({ items: a.data.items, pending: a.sync.pending, conflicts: a.conflicts, discard: a.sync.discard ?? [] }, id, newUuid(), newUuid);
      return { ...a, data: { ...a.data, items: s.items }, sync: { ...a.sync, pending: s.pending }, conflicts: s.conflicts };
    }),
    retrySync: () => { flush(); },
    signOutAccount: async () => {
      wiped.current = true;
      await clearAccountCache(allRef.current);
      await auth.signOut();
    },
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
