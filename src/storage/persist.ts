import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { AppData } from '../types';

import { accountKey, emptyAppData, parseStored } from '../cloud/scope';

/**
 * Local cache for ONE account (`wmw:v2:<user id>`). The old browser/demo blob `wmw:v1` is never read,
 * imported or deleted: a new account always starts empty.
 */
export async function loadData(userId: string): Promise<AppData> {
  try {
    const s = await AsyncStorage.getItem(accountKey(userId));
    const d = parseStored(s, userId);
    if (d) return d;
  } catch {}
  return emptyAppData(userId);
}

/** Returns false when the device could not store the data (full disk, blocked storage). */
export async function saveData(d: AppData): Promise<boolean> {
  try { await AsyncStorage.setItem(accountKey(d.userId), JSON.stringify(d)); return true; } catch { return false; }
}

/** Sign-out on a shared device: drop this account's cache and the photo copies it references. */
export async function clearAccountCache(d: AppData): Promise<void> {
  try { await AsyncStorage.removeItem(accountKey(d.userId)); } catch {}
  if (Platform.OS === 'web') return;
  for (const it of d.data.items) {
    if (!it.photoUri || !it.photoUri.startsWith('file:')) continue;
    try { new File(it.photoUri).delete(); } catch {}
  }
}

/** Raw bytes of a stored photo (file:// on device, data: URI on web) for upload. */
export async function readPhotoBytes(uri: string): Promise<ArrayBuffer> {
  const r = await fetch(uri);
  if (!r.ok && Platform.OS !== 'web') throw new Error(`photo read failed (${r.status})`);
  return r.arrayBuffer();
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
