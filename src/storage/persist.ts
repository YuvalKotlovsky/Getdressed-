import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { AppData } from '../types';
import { demoModeData, emptyModeData } from '../data/demo';
import { DEFAULT_CITY } from '../weather/weather';

const KEY = 'wmw:v1';

export const freshData = (): AppData => ({
  version: 1, mode: 'demo', demo: demoModeData(), mine: emptyModeData(),
  settings: { cityId: DEFAULT_CITY, weatherOverride: {} },
});

export async function loadData(): Promise<AppData> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (s) {
      const d = JSON.parse(s) as AppData;
      if (d?.version === 1) return { ...d, settings: { ...d.settings, cityId: d.settings?.cityId ?? DEFAULT_CITY, weatherOverride: d.settings?.weatherOverride ?? {} } };
    }
  } catch {}
  return freshData();
}

export async function saveData(d: AppData): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(d)); } catch {}
}

export interface PreparedPhoto {
  /** where the photo is stored on this device (file:// on native, data URI on web) */
  uri: string;
  /** resized JPEG for optional analysis, only uploaded after the user agrees */
  base64: string;
  mediaType: 'image/jpeg';
}

/**
 * Store a picked photo on the device only. Resized to keep storage small.
 * Native: copied into the app's document directory. Web: kept as a data URI.
 */
export async function persistPhoto(uri: string): Promise<PreparedPhoto> {
  const r = await manipulateAsync(uri, [{ resize: { width: 800 } }], { compress: 0.7, format: SaveFormat.JPEG, base64: true });
  const base64 = r.base64 ?? '';
  if (Platform.OS === 'web') return { uri: `data:image/jpeg;base64,${base64}`, base64, mediaType: 'image/jpeg' };
  const dest = new File(Paths.document, `closet-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`);
  new File(r.uri).copy(dest);
  return { uri: dest.uri, base64, mediaType: 'image/jpeg' };
}
