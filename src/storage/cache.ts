import type { AppData } from '../types';
import { accountKey } from '../cloud/scope';

export interface KV {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
}

/**
 * Per-account cache writes go through ONE serial queue per key. Without it, a save that was already in flight
 * when the user signed out could finish AFTER the removal and recreate the old account's cache (and the photos
 * list it references) on a shared device. With it, the removal always runs after every earlier write, and a
 * later account (a different key, or the same account signing in again) only writes after the removal.
 */
export function createCache(kv: KV) {
  const chains = new Map<string, Promise<unknown>>();
  function enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(job, job);
    chains.set(key, next.catch(() => undefined));
    return next;
  }
  return {
    read: (userId: string) => enqueue(accountKey(userId), () => kv.getItem(accountKey(userId))),
    /** false when the device could not store the data */
    save: (d: AppData) =>
      enqueue(accountKey(d.userId), async () => { try { await kv.setItem(accountKey(d.userId), JSON.stringify(d)); return true; } catch { return false; } }),
    clear: (userId: string) =>
      enqueue(accountKey(userId), async () => { try { await kv.removeItem(accountKey(userId)); } catch {} }),
  };
}
