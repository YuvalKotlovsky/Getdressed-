import type { Item, StaleEdit, SyncOp } from '../types';

/**
 * Wardrobe sync engine. Pure logic over a small `CloudApi`, so it can be tested with an in-memory fake.
 *
 * Contract (see supabase/migrations):
 *  - table wardrobe_items: id (client uuid), user_id (server: auth.uid()), data jsonb, photo_path, deleted_at, updated_at
 *  - private bucket closet-photos, object path `{user_id}/{item_id}/{photo_id}.jpg`
 *
 * Conflict rule (enforced by the database trigger `wardrobe_items_tombstone_terminal`):
 *   DELETE WINS. Once an item has `deleted_at`, it can never be edited or restored; a later write from any device
 *   is rejected with `item_deleted`. To bring such an item back, the user saves their copy as a NEW item (new id).
 *   Between two live edits the last write still wins.
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

/** The server refused a write because the item was deleted (by this or another device). */
export class ItemDeletedError extends Error {
  constructor() { super('item_deleted'); this.name = 'ItemDeletedError'; }
}
export const isItemDeleted = (e: unknown) =>
  e instanceof ItemDeletedError || (e instanceof Error && /item_deleted/.test(e.message));

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
  /** the item was deleted elsewhere: the edit is NOT saved; `discard` are uploaded objects that can be removed */
  | { done: true; rejected: 'deleted'; discard: string[] }
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
    if (op.kind === 'upsert' && isItemDeleted(e)) {
      const discard = [cur.uploadedPath, ...(op.cleanup ?? [])].filter((x): x is string => !!x);
      await api.removePhotos(discard).catch(() => {});
      return { done: true, rejected: 'deleted', discard };
    }
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

/** The part of the local state that sync changes. */
export interface SyncSlice {
  items: Item[];
  pending: Record<string, SyncOp>;
  conflicts: StaleEdit[];
  /** object paths waiting to be removed (persisted in SyncState.discard) */
  discard: string[];
}

const addConflict = (list: StaleEdit[], c: StaleEdit) => [...list.filter((x) => x.id !== c.id), c];

/** Apply the outcome of pushing one op. Pure, so both the app and the tests use the same rules. */
export function applyFlushResult(s: SyncSlice, id: string, sent: SyncOp, res: FlushResult, now: string): SyncSlice {
  if (s.pending[id] !== sent) return s; // edited again while sending: the newer op will run next
  const pending = { ...s.pending };
  if (!res.done) { pending[id] = res.op; return { ...s, pending }; }
  delete pending[id];
  if ('rejected' in res) {
    const edited = s.items.find((i) => i.id === id);
    return {
      ...s,
      items: s.items.filter((i) => i.id !== id),
      pending,
      conflicts: edited ? addConflict(s.conflicts, { id, item: edited, at: now }) : s.conflicts,
    };
  }
  const items = res.photoPath === undefined ? s.items : s.items.map((i) => (i.id === id ? { ...i, photoPath: res.photoPath ?? undefined } : i));
  return { ...s, items, pending };
}

/**
 * Apply pulled rows. A remote tombstone for an item with an UNSENT local edit is a conflict: delete wins, the edit is
 * kept in `conflicts` (not lost) and its pending op is dropped. `discard` lists uploaded objects of the dropped op.
 */
export function applyPull(s: SyncSlice, rows: RemoteRow[], now: string): SyncSlice {
  let pending = s.pending;
  let items = s.items;
  let conflicts = s.conflicts;
  const discard: string[] = [...s.discard];
  for (const r of rows) {
    const op = pending[r.id];
    if (!r.deleted_at || !op || op.kind !== 'upsert') continue;
    const edited = items.find((i) => i.id === r.id);
    if (edited) conflicts = addConflict(conflicts, { id: r.id, item: edited, at: now });
    items = items.filter((i) => i.id !== r.id);
    discard.push(...[op.uploadedPath, ...(op.cleanup ?? [])].filter((x): x is string => !!x));
    pending = { ...pending }; delete pending[r.id];
  }
  return { items: mergeRemote(items, pending, rows), pending, conflicts, discard: [...new Set(discard)] };
}

/**
 * "Save as a new item": the rejected edit becomes a NEW item (new id, queued for upload); the deleted one stays deleted.
 * Doing the lookup and removal in one pure step makes a double tap harmless (the second call finds nothing).
 */
export function applyRestoreStale(s: SyncSlice, id: string, newItemId: string, newPhotoId: () => string): SyncSlice {
  const c = s.conflicts.find((x) => x.id === id);
  if (!c) return s;
  const fresh: Item = { ...c.item, id: newItemId, photoPath: undefined };
  return {
    ...s,
    items: [...s.items, fresh],
    conflicts: s.conflicts.filter((x) => x.id !== id),
    pending: { ...s.pending, [fresh.id]: planSave(undefined, fresh, undefined, newPhotoId) },
  };
}
