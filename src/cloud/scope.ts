import type { AppData } from '../types';
import { emptyModeData } from '../data/empty';
import { DEFAULT_CITY } from '../weather/weather';

export const accountKey = (userId: string) => `wmw:v2:${userId}`;

export const emptyAppData = (userId: string): AppData => ({
  version: 2, userId, data: emptyModeData(), sync: { pending: {} }, conflicts: [],
  settings: { cityId: DEFAULT_CITY, weatherOverride: {} },
});

/** Accepts a stored blob only if it belongs to exactly this account; anything else is ignored (never merged). */
export function parseStored(raw: string | null, userId: string): AppData | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as AppData;
    if (d?.version !== 2 || d.userId !== userId || !d.data || !Array.isArray(d.data.items)) return null;
    const base = emptyAppData(userId);
    return {
      ...d,
      data: { ...base.data, ...d.data },
      sync: { cursor: d.sync?.cursor, pending: d.sync?.pending ?? {}, discard: d.sync?.discard ?? [] },
      conflicts: Array.isArray(d.conflicts) ? d.conflicts : [],
      settings: { ...base.settings!, ...d.settings, weatherOverride: d.settings?.weatherOverride ?? {} },
    };
  } catch { return null; }
}
