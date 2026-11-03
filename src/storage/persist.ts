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
export async function persistPhoto(uri: string, dims?: { width: number; height: number }): Promise<PreparedPhoto> {
  // keep the longer edge <= 1400px (tall screenshots keep enough detail for recognition); never upscale
  const LONG = 1400;
  const actions = dims
    ? Math.max(dims.width, dims.height) > LONG ? [{ resize: dims.height > dims.width ? { height: LONG } : { width: LONG } }] : []
    : [{ resize: { width: 1000 } }];
  const r = await manipulateAsync(uri, actions, { compress: 0.7, format: SaveFormat.JPEG, base64: true });
  const base64 = r.base64 ?? '';
  if (Platform.OS === 'web') return { uri: `data:image/jpeg;base64,${base64}`, base64, mediaType: 'image/jpeg' };
  const dest = new File(Paths.document, `closet-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`);
  new File(r.uri).copy(dest);
  return { uri: dest.uri, base64, mediaType: 'image/jpeg' };
}

/** Base64 image (e.g. a product photo returned by the server) -> stored on this device like any picked photo. */
export async function photoFromBase64(base64: string, mediaType = 'image/jpeg'): Promise<PreparedPhoto> {
  if (Platform.OS === 'web') return persistPhoto(`data:${mediaType};base64,${base64}`);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const tmp = new File(Paths.cache, `import-${Date.now()}.jpg`);
  tmp.create({ overwrite: true });
  tmp.write(bytes);
  return persistPhoto(tmp.uri);
}
