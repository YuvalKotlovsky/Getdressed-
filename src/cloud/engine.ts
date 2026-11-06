import type { Item, SyncOp } from '../types';

/**
 * Wardrobe sync engine. Pure logic over a small `CloudApi`, so it can be tested with an in-memory fake.
 *
 * Contract (see supabase/migrations):
 *  - table wardrobe_items: id (client uuid), user_id (server: auth.uid()), data jsonb, photo_path, deleted_at, updated_at
 *  - private bucket closet-photos, object path `{user_id}/{item_id}/{photo_id}.jpg`
 *
 * Retry safety: ids are client-generated and writes are upserts; the photo path is fixed per attempt
 * (stored in the pending op), so repeating a failed save never creates a second item or a second object.
 */
export interface RemoteRow {
  id: string;
  data: Record<string, unknown>;
  photo_path: string | null;
  deleted_at: string | null;
  updated_at: string;
}

export interface CloudApi {
  upsertItem(row: { id: string; data: Record<string, unknown>; photo_path: string | null }): Promise<void>;
  tombstoneItem(id: string): Promise<void>;
  listChanged(after: string | undefined, limit: number): Promise<RemoteRow[]>;
  uploadPhoto(path: string, bytes: ArrayBuffer): Promise<void>;
  removePhotos(paths: string[]): Promise<void>;
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
}

export const PAGE = 500;
export const PULL_OVERLAP_MS = 5000;
export const photoObjectPath = (userId: string, itemId: string, photoId: string) => `${userId}/${itemId}/${photoId}.jpg`;

/** What goes into the `data` column: tags and availability, never ids, local photo paths or demo flags. */
export function itemToRemoteData(item: Item): Record<string, unknown> {
  const { id: _id, photoUri: _p, photoPath: _pp, demo: _d, ...rest } = item;
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>;
}

export function remoteToItem(row: RemoteRow, local?: Item): Item {
  const photoPath = row.photo_path ?? undefined;
  const keepLocalPhoto = !!local?.photoUri && local.photoPath === photoPath;
  return { ...(row.data as unknown as Item), id: row.id, photoPath, photoUri: keepLocalPhoto ? local!.photoUri : undefined };
}

/** Queue an upsert for a saved item. A changed local photo gets a fresh photo id; an earlier uploaded attempt is cleaned up later. */
export function planSave(prev: Item | undefined, next: Item, prevOp: SyncOp | undefined, newId: () => string): SyncOp {
  const base: SyncOp = prevOp && prevOp.kind === 'upsert' ? { ...prevOp } : { kind: 'upsert', attempts: 0, cleanup: [] };
  if (next.photoUri && next.photoUri !== prev?.photoUri) {
    const cleanup = [...(base.cleanup ?? [])];
    if (base.uploadedPath) cleanup.push(base.uploadedPath); // superseded upload from a failed earlier attempt
    return { ...base, cleanup, photoLocalUri: next.photoUri, photoId: newId(), uploadedPath: undefined, attempts: 0, lastError: undefined };
  }
  return { ...base, attempts: 0, lastError: undefined };
}

export function planDelete(prev: Item | undefined, prevOp: SyncOp | undefined): SyncOp {
  const cleanup = [...(prevOp?.cleanup ?? []), prevOp?.uploadedPath, prev?.photoPath].filter((x): x is string => !!x);
  return { kind: 'delete', attempts: 0, cleanup: [...new Set(cleanup)] };
}

export type FlushResult =
  | { done: true; photoPath?: string | null }
  | { done: false; op: SyncOp };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/** Push one pending op. On failure returns the (possibly progressed) op so the next attempt resumes where this one stopped. */
export async function flushOp(
  api: CloudApi, userId: string, itemId: string, op: SyncOp, item: Item | undefined,
  readPhoto: (uri: string) => Promise<ArrayBuffer>,
): Promise<FlushResult> {
  let cur = op;
  try {
    if (op.kind === 'delete') {
      await api.tombstoneItem(itemId);
      await api.removePhotos(op.cleanup ?? []).catch(() => {}); // a leftover object is an orphan, never a visible item
      return { done: true };
    }
    if (!item) return { done: true }; // item vanished locally; nothing to push
    let path: string | null = item.photoPath ?? null;
    if (op.photoLocalUri && op.photoId) {
      const target = photoObjectPath(userId, itemId, op.photoId);
      if (op.uploadedPath !== target) {
        await api.uploadPhoto(target, await readPhoto(op.photoLocalUri));
        cur = { ...cur, uploadedPath: target }; // persisted even if the row write below fails
      }
      path = target;
    }
    await api.upsertItem({ id: itemId, data: itemToRemoteData(item), photo_path: path });
    const stale = [...(op.cleanup ?? []), item.photoPath && item.photoPath !== path ? item.photoPath : undefined].filter((x): x is string => !!x);
    if (stale.length) await api.removePhotos(stale).catch(() => {});
    return { done: true, photoPath: path };
  } catch (e) {
    return { done: false, op: { ...cur, attempts: cur.attempts + 1, lastError: msg(e) } };
  }
}

/** Retry delay: 2s, 4s, ... capped at 60s. */
export const backoffMs = (attempts: number) => Math.min(60000, 2000 * 2 ** Math.max(0, attempts - 1));

export const startCursor = (cursor?: string): string | undefined =>
  cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : undefined;

/** Fetch every change since the cursor (with a small overlap, merge is idempotent). */
export async function pullAll(api: CloudApi, cursor?: string): Promise<{ rows: RemoteRow[]; cursor?: string }> {
  const rows: RemoteRow[] = [];
  let after = startCursor(cursor);
  for (;;) {
    const page = await api.listChanged(after, PAGE);
    rows.push(...page);
    if (page.length < PAGE) break;
    after = page[page.length - 1].updated_at;
  }
  const newest = rows.reduce<string | undefined>((m, r) => (!m || r.updated_at > m ? r.updated_at : m), cursor);
  return { rows, cursor: newest };
}

/** Merge remote changes into local items. Items with an unsent local change win (they will overwrite remote on push). */
export function mergeRemote(local: Item[], pending: Record<string, SyncOp>, rows: RemoteRow[]): Item[] {
  const byId = new Map(local.map((i) => [i.id, i]));
  for (const r of rows) {
    if (pending[r.id]) continue;
    if (r.deleted_at) byId.delete(r.id);
    else byId.set(r.id, remoteToItem(r, byId.get(r.id)));
  }
  return [...byId.values()];
}
