import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { AppData } from '../types';
import { demoModeData, emptyModeData } from '../data/demo';

const KEY = 'wmw:v1';

export const freshData = (): AppData => ({ version: 1, mode: 'demo', demo: demoModeData(), mine: emptyModeData() });

export async function loadData(): Promise<AppData> {
  try {
    const s = await AsyncStorage.getItem(KEY);
    if (s) {
      const d = JSON.parse(s) as AppData;
      if (d?.version === 1) return d;
    }
  } catch {}
  return freshData();
}

export async function saveData(d: AppData): Promise<void> {
  try { await AsyncStorage.setItem(KEY, JSON.stringify(d)); } catch {}
}

/**
 * Store a picked photo on the device only. Resized to keep storage small.
 * Native: copied into the app's document directory (file://). Web: data URI.
 */
export async function persistPhoto(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const r = await manipulateAsync(uri, [{ resize: { width: 700 } }], { compress: 0.6, format: SaveFormat.JPEG, base64: true });
    return `data:image/jpeg;base64,${r.base64}`;
  }
  const r = await manipulateAsync(uri, [{ resize: { width: 900 } }], { compress: 0.7, format: SaveFormat.JPEG });
  const dest = new File(Paths.document, `closet-${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`);
  new File(r.uri).copy(dest);
  return dest.uri;
}
