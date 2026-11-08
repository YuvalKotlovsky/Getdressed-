import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItemDeletedError, applyFlushResult, applyPull, applyRestoreStale, backoffMs, flushOp, mergeRemote, planDelete, planSave, pullAll, photoObjectPath, itemToRemoteData, type CloudApi, type RemoteRow } from '../src/cloud/engine';
import { accountKey, emptyAppData, parseStored } from '../src/cloud/scope';
import { parseCloudConfig } from '../src/cloud/config';
import { authErrorHe } from '../src/auth/errors';
import type { Item, StaleEdit, SyncOp } from '../src/types';

const UID = '11111111-1111-4111-8111-111111111111';
const ITEM_ID = '22222222-2222-4222-8222-222222222222';
const item = (over: Partial<Item> = {}): Item => ({ id: ITEM_ID, name: 'חולצה', category: 'top', part: 'top', color: 'white', dressiness: 1, occasions: ['casual'], available: true, ...over });

/** In-memory stand-in for Supabase: rows, storage objects, and switchable failures. */
function fake() {
  const rows = new Map<string, RemoteRow>();
  const objects = new Map<string, number>();
  let clock = 0;
  const f = { failUpload: 0, failUpsert: 0, failRemove: false, offline: false, upserts: 0, uploads: 0 };
  const api: CloudApi = {
    async upsertItem(r) {
      if (f.offline) throw new Error('fetch failed');
      if (f.failUpsert > 0) { f.failUpsert--; throw new Error('row write failed'); }
      if (rows.get(r.id)?.deleted_at) throw new ItemDeletedError(); // mirrors trigger wardrobe_items_tombstone_terminal
      f.upserts++;
      rows.set(r.id, { id: r.id, data: r.data, photo_path: r.photo_path, deleted_at: null, updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString() });
    },
    async tombstoneItem(id) {
      if (f.offline) throw new Error('fetch failed');
      const r = rows.get(id); if (r) rows.set(id, { ...r, deleted_at: r.deleted_at ?? 'x', updated_at: new Date(Date.UTC(2026, 0, 1, 0, 0, ++clock)).toISOString() });
    },
    async listChanged(after, limit) {
      if (f.offline) throw new Error('fetch failed');
      return [...rows.values()].filter((r) => !after || r.updated_at > after).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).slice(0, limit);
    },
    async uploadPhoto(path, bytes) {
      if (f.offline) throw new Error('fetch failed');
      if (f.failUpload > 0) { f.failUpload--; throw new Error('upload failed'); }
      f.uploads++; objects.set(path, bytes.byteLength);
    },
    async removePhotos(paths) { if (f.failRemove) throw new Error('remove failed'); paths.forEach((p) => objects.delete(p)); },
    async signedUrl(path) { return `https://signed.example/${path}`; },
  };
  return { api, rows, objects, f };
}
const read = async () => new ArrayBuffer(8);
let n = 0;
const ids = () => `photo-${++n}`;

test('new account is empty and its cache key is per user', () => {
  const d = emptyAppData(UID);
  assert.equal(d.data.items.length, 0);
  assert.deepEqual(d.sync.pending, {});
  assert.equal(accountKey(UID), `wmw:v2:${UID}`);
  assert.notEqual(accountKey(UID), accountKey('other'));
});

test('a cache blob of another account (or the old demo blob) is never accepted', () => {
  const mine = emptyAppData(UID); mine.data.items.push(item());
  assert.equal(parseStored(JSON.stringify(mine), UID)?.data.items.length, 1);
  assert.equal(parseStored(JSON.stringify(mine), 'someone-else'), null);
  assert.equal(parseStored(JSON.stringify({ version: 1, mode: 'demo', demo: { items: [item()] }, mine: { items: [] } }), UID), null);
  assert.equal(parseStored('not json', UID), null);
  assert.equal(parseStored(null, UID), null);
});

test('synced data holds tags and availability but never local photo paths or ids', () => {
  const data = itemToRemoteData(item({ photoUri: 'file:///x.jpg', photoPath: 'p', demo: true, brand: 'Zara' }));
  assert.deepEqual(Object.keys(data).sort(), ['available', 'brand', 'category', 'color', 'dressiness', 'name', 'occasions', 'part']);
});

test('save with photo: uploads to the contract path, then writes the row', async () => {
  const { api, rows, objects } = fake();
  const it = item({ photoUri: 'file:///a.jpg' });
  const op = planSave(undefined, it, undefined, () => 'ph1');
  const res = await flushOp(api, UID, ITEM_ID, op, it, read);
  assert.equal(res.done, true);
  const path = photoObjectPath(UID, ITEM_ID, 'ph1');
  assert.equal(path, `${UID}/${ITEM_ID}/ph1.jpg`);
  assert.ok(objects.has(path));
  assert.equal(rows.get(ITEM_ID)?.photo_path, path);
});

test('photo uploaded but row save fails: kept pending, retry reuses the same object and creates one row', async () => {
  const { api, rows, objects, f } = fake();
  const it = item({ photoUri: 'file:///a.jpg' });
  let op: SyncOp = planSave(undefined, it, undefined, () => 'ph1');
  f.failUpsert = 1;
  const r1 = await flushOp(api, UID, ITEM_ID, op, it, read);
  assert.equal(r1.done, false);
  if (r1.done) return;
  assert.equal(r1.op.uploadedPath, `${UID}/${ITEM_ID}/ph1.jpg`);
  assert.equal(r1.op.attempts, 1);
  assert.equal(rows.size, 0);
  op = r1.op;
  const r2 = await flushOp(api, UID, ITEM_ID, op, it, read);
  assert.equal(r2.done, true);
  assert.equal(rows.size, 1);
  assert.equal(objects.size, 1);
  assert.equal(f.uploads, 1, 'the photo was not uploaded twice');
});

test('retrying a finished save is idempotent (no duplicate item)', async () => {
  const { api, rows } = fake();
  const it = item();
  const op = planSave(undefined, it, undefined, ids);
  await flushOp(api, UID, ITEM_ID, op, it, read);
  await flushOp(api, UID, ITEM_ID, op, it, read);
  assert.equal(rows.size, 1);
});

test('upload failure: nothing is written, the op stays pending with the error', async () => {
  const { api, rows, f } = fake();
  const it = item({ photoUri: 'file:///a.jpg' });
  f.failUpload = 1;
  const r = await flushOp(api, UID, ITEM_ID, planSave(undefined, it, undefined, () => 'ph1'), it, read);
  assert.equal(r.done, false);
  if (!r.done) { assert.equal(r.op.uploadedPath, undefined); assert.match(r.op.lastError ?? '', /upload failed/); }
  assert.equal(rows.size, 0);
});

test('replacing the photo before the first one synced cleans up the superseded upload', async () => {
  const { api, objects, f } = fake();
  const a = item({ photoUri: 'file:///a.jpg' });
  f.failUpsert = 1;
  const r1 = await flushOp(api, UID, ITEM_ID, planSave(undefined, a, undefined, () => 'ph1'), a, read);
  assert.equal(r1.done, false); if (r1.done) return;
  const b = item({ photoUri: 'file:///b.jpg' });
  const op2 = planSave(a, b, r1.op, () => 'ph2');
  assert.deepEqual(op2.cleanup, [`${UID}/${ITEM_ID}/ph1.jpg`]);
  const r2 = await flushOp(api, UID, ITEM_ID, op2, b, read);
  assert.equal(r2.done, true);
  assert.deepEqual([...objects.keys()], [`${UID}/${ITEM_ID}/ph2.jpg`]);
});

test('delete writes a tombstone and removes the photo object; failed object removal does not fail the delete', async () => {
  const { api, rows, objects, f } = fake();
  const it = item({ photoUri: 'file:///a.jpg' });
  await flushOp(api, UID, ITEM_ID, planSave(undefined, it, undefined, () => 'ph1'), it, read);
  const synced = { ...it, photoPath: `${UID}/${ITEM_ID}/ph1.jpg` };
  f.failRemove = true;
  const r = await flushOp(api, UID, ITEM_ID, planDelete(synced, undefined), undefined, read);
  assert.equal(r.done, true);
  assert.ok(rows.get(ITEM_ID)?.deleted_at);
  assert.equal(objects.size, 1, 'leftover object is an orphan, not a visible item');
});

test('offline: ops stay pending; pull reports the failure to the caller', async () => {
  const { api, f } = fake();
  f.offline = true;
  const it = item();
  const r = await flushOp(api, UID, ITEM_ID, planSave(undefined, it, undefined, ids), it, read);
  assert.equal(r.done, false);
  await assert.rejects(() => pullAll(api, undefined));
  assert.equal(backoffMs(1), 2000);
  assert.equal(backoffMs(20), 60000);
});

test('second device: pull shows the item, its tags and photo path; tombstones remove it; unsent local edits win', async () => {
  const { api } = fake();
  const it = item({ photoUri: 'file:///a.jpg', name: 'מקור' });
  await flushOp(api, UID, ITEM_ID, planSave(undefined, it, undefined, () => 'ph1'), it, read);
  const { rows, cursor } = await pullAll(api, undefined);
  const dev2 = mergeRemote([], {}, rows);
  assert.equal(dev2.length, 1);
  assert.equal(dev2[0].name, 'מקור');
  assert.equal(dev2[0].photoPath, `${UID}/${ITEM_ID}/ph1.jpg`);
  assert.equal(dev2[0].photoUri, undefined, 'the other device has no local file; it loads through a signed URL');
  assert.ok(cursor);
  // local unsent edit wins over remote
  const edited = { ...dev2[0], name: 'שונה כאן' };
  assert.equal(mergeRemote([edited], { [ITEM_ID]: { kind: 'upsert', attempts: 0 } }, rows)[0].name, 'שונה כאן');
  // a tombstone removes it
  await flushOp(api, UID, ITEM_ID, planDelete(dev2[0], undefined), undefined, read);
  const next = await pullAll(api, cursor);
  assert.equal(mergeRemote(dev2, {}, next.rows).length, 0);
});

test('config refuses secret keys and non-https URLs', () => {
  const jwt = (role: string) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`;
  assert.equal(parseCloudConfig(undefined, undefined).ok, false);
  assert.deepEqual(parseCloudConfig('https://a.supabase.co', jwt('service_role')), { ok: false, reason: 'secret-key' });
  assert.deepEqual(parseCloudConfig('https://a.supabase.co', 'sb_secret_abc'), { ok: false, reason: 'secret-key' });
  assert.deepEqual(parseCloudConfig('http://a.supabase.co', jwt('anon')), { ok: false, reason: 'bad-url' });
  assert.equal(parseCloudConfig('https://a.supabase.co/', jwt('anon')).ok, true);
  assert.equal(parseCloudConfig('http://localhost:54321', 'sb_publishable_abc').ok, true);
});

test('auth errors are Hebrew and never leak server text', () => {
  assert.match(authErrorHe('invalid_credentials'), /שגויים/);
  assert.match(authErrorHe('email_not_confirmed'), /לאמת/);
  assert.doesNotMatch(authErrorHe('some weird internal postgres error'), /postgres/);
});

// ---------- delete wins: stale edit from another device ----------
type Device = { items: Item[]; pending: Record<string, SyncOp>; conflicts: StaleEdit[]; discard: string[]; cursor?: string };
const device = (): Device => ({ items: [], pending: {}, conflicts: [], discard: [] });
const NOW = '2026-11-08T10:00:00.000Z';
const edit = (d: Device, it: Item) => {
  const prev = d.items.find((i) => i.id === it.id);
  d.items = prev ? d.items.map((i) => (i.id === it.id ? it : i)) : [...d.items, it];
  d.pending = { ...d.pending, [it.id]: planSave(prev, it, d.pending[it.id], ids) };
};
const remove = (d: Device, id: string) => {
  const prev = d.items.find((i) => i.id === id);
  d.items = d.items.filter((i) => i.id !== id);
  d.pending = { ...d.pending, [id]: planDelete(prev, d.pending[id]) };
};
async function sync(api: CloudApi, d: Device) {
  for (const id of Object.keys(d.pending)) {
    const op = d.pending[id];
    const res = await flushOp(api, UID, id, op, d.items.find((i) => i.id === id), read);
    const s = applyFlushResult({ items: d.items, pending: d.pending, conflicts: d.conflicts, discard: d.discard }, id, op, res, NOW);
    d.items = s.items; d.pending = s.pending; d.conflicts = s.conflicts; d.discard = s.discard;
  }
  const { rows, cursor } = await pullAll(api, d.cursor);
  const s = applyPull({ items: d.items, pending: d.pending, conflicts: d.conflicts, discard: d.discard }, rows, NOW);
  d.items = s.items; d.pending = s.pending; d.conflicts = s.conflicts; d.discard = s.discard; d.cursor = cursor;
}

test('regression: both clients load an item, A deletes and syncs, B submits a stale edit -> item stays deleted for both', async () => {
  const { api, rows } = fake();
  const a = device(), b = device();
  edit(a, item({ name: 'מקור' }));
  await sync(api, a);
  await sync(api, b);
  assert.equal(a.items.length, 1);
  assert.equal(b.items.length, 1, 'both clients loaded the item');

  remove(a, ITEM_ID);
  await sync(api, a);
  assert.ok(rows.get(ITEM_ID)?.deleted_at, 'A deleted it in the cloud');

  edit(b, item({ name: 'עריכה ישנה מ-B' })); // B has not refreshed yet
  await sync(api, b);

  assert.equal(rows.get(ITEM_ID)?.data.name, 'מקור', 'the stale edit did not change the cloud record');
  assert.ok(rows.get(ITEM_ID)?.deleted_at, 'the cloud record is still deleted');
  await sync(api, a);
  await sync(api, b);
  assert.equal(a.items.length, 0, 'A: still deleted after refresh');
  assert.equal(b.items.length, 0, 'B: still deleted after refresh');
  assert.deepEqual(b.pending, {}, 'nothing left to retry');
  assert.equal(b.conflicts.length, 1, 'B is told about the rejected edit');
  assert.equal(b.conflicts[0].item.name, 'עריכה ישנה מ-B', 'the user edit is preserved, not lost');
});

test('stale edit after remote delete is caught at pull time (before any push) and the edit is kept', async () => {
  const { api, rows } = fake();
  const a = device(), b = device();
  edit(a, item());
  await sync(api, a); await sync(api, b);
  remove(a, ITEM_ID); await sync(api, a);
  edit(b, item({ name: 'ערוך אצל B' }));              // unsent edit on B
  const { rows: pulled } = await pullAll(api, b.cursor);
  const s = applyPull({ items: b.items, pending: b.pending, conflicts: b.conflicts, discard: b.discard }, pulled, NOW);
  assert.equal(s.items.length, 0);
  assert.deepEqual(s.pending, {});
  assert.equal(s.conflicts[0].item.name, 'ערוך אצל B');
  assert.ok(rows.get(ITEM_ID)?.deleted_at);
});

test('a rejected edit with a new photo discards the uploaded object and never touches the deleted row', async () => {
  const { api, rows, objects } = fake();
  const a = device(), b = device();
  edit(a, item()); await sync(api, a); await sync(api, b);
  remove(a, ITEM_ID); await sync(api, a);
  edit(b, item({ photoUri: 'file:///new.jpg', name: 'עם תמונה חדשה' }));
  await sync(api, b);
  assert.equal(objects.size, 0, 'the photo uploaded for the rejected edit was removed');
  assert.equal(rows.get(ITEM_ID)?.photo_path, null);
  assert.equal(b.conflicts.length, 1);
});

test('repeating a delete is harmless; a stale delete+edit race resolves to deleted', async () => {
  const { api, rows } = fake();
  const a = device();
  edit(a, item()); await sync(api, a);
  remove(a, ITEM_ID); await sync(api, a);
  const first = rows.get(ITEM_ID)?.deleted_at;
  a.pending = { [ITEM_ID]: planDelete(undefined, undefined) };
  await sync(api, a);
  assert.equal(rows.get(ITEM_ID)?.deleted_at, first, 'original deletion time is kept');
  assert.deepEqual(a.pending, {});
});

test('an unsent edit survives a pull when the item is NOT deleted (live edits: last write wins)', async () => {
  const { api } = fake();
  const a = device(), b = device();
  edit(a, item()); await sync(api, a); await sync(api, b);
  edit(b, item({ name: 'חדש אצל B' }));
  const { rows: pulled } = await pullAll(api, undefined);
  const s = applyPull({ items: b.items, pending: b.pending, conflicts: b.conflicts, discard: b.discard }, pulled, NOW);
  assert.equal(s.items[0].name, 'חדש אצל B');
  assert.ok(s.pending[ITEM_ID]);
  assert.equal(s.conflicts.length, 0);
});

test('edited again while a push was in flight: the stale result is ignored, the newer op stays', () => {
  const it = item({ name: 'v2' });
  const sent: SyncOp = { kind: 'upsert', attempts: 0 };
  const newer: SyncOp = { kind: 'upsert', attempts: 0, photoId: 'newer' };
  const before = { items: [it], pending: { [ITEM_ID]: newer }, conflicts: [], discard: [] };
  assert.equal(applyFlushResult(before, ITEM_ID, sent, { done: true, rejected: 'deleted', discard: [] }, NOW), before);
});

test('pull-time conflict lists the uploaded-but-unsent photo for removal; a pending DELETE op is not a conflict', async () => {
  const { api } = fake();
  const a = device(), b = device();
  edit(a, item()); await sync(api, a); await sync(api, b);
  remove(a, ITEM_ID); await sync(api, a);
  const upPath = `${UID}/${ITEM_ID}/ph9.jpg`;
  b.pending = { [ITEM_ID]: { kind: 'upsert', attempts: 1, uploadedPath: upPath, cleanup: [`${UID}/${ITEM_ID}/old.jpg`] } };
  const { rows } = await pullAll(api, undefined);
  const s = applyPull({ items: b.items, pending: b.pending, conflicts: [], discard: [] }, rows, NOW);
  assert.deepEqual(s.discard.sort(), [upPath, `${UID}/${ITEM_ID}/old.jpg`].sort());
  assert.equal(s.conflicts.length, 1);
  // a user who ALSO deleted it locally has nothing to resolve
  const s2 = applyPull({ items: [], pending: { [ITEM_ID]: planDelete(undefined, undefined) }, conflicts: [], discard: [] }, rows, NOW);
  assert.equal(s2.conflicts.length, 0);
  assert.ok(s2.pending[ITEM_ID], 'the delete op is kept and will finish idempotently');
});

test('save a rejected edit as a NEW item: new id, queued, deleted id never reused, double tap is harmless', () => {
  const edited = item({ name: 'העריכה שלי', photoUri: 'file:///mine.jpg', photoPath: `${UID}/${ITEM_ID}/old.jpg` });
  const s0 = { items: [], pending: {}, conflicts: [{ id: ITEM_ID, item: edited, at: NOW }], discard: [] };
  const NEW_ID = '33333333-3333-4333-8333-333333333333';
  const s1 = applyRestoreStale(s0, ITEM_ID, NEW_ID, () => 'ph-new');
  assert.equal(s1.items.length, 1);
  assert.equal(s1.items[0].id, NEW_ID);
  assert.notEqual(s1.items[0].id, ITEM_ID);
  assert.equal(s1.items[0].name, 'העריכה שלי');
  assert.equal(s1.items[0].photoPath, undefined, 'the old cloud photo path is not carried over');
  assert.equal(s1.conflicts.length, 0);
  assert.equal(s1.pending[NEW_ID].photoLocalUri, 'file:///mine.jpg', 'the local photo is uploaded for the new item');
  const s2 = applyRestoreStale(s1, ITEM_ID, '44444444-4444-4444-8444-444444444444', () => 'x');
  assert.equal(s2, s1, 'a second tap finds nothing and changes nothing');
});

test('conflicts and the discard list survive save/reload of the account cache', () => {
  const d = emptyAppData(UID);
  d.conflicts = [{ id: ITEM_ID, item: item({ name: 'x' }), at: NOW }];
  d.sync.discard = ['a/b/c.jpg'];
  const back = parseStored(JSON.stringify(d), UID)!;
  assert.equal(back.conflicts[0].item.name, 'x');
  assert.deepEqual(back.sync.discard, ['a/b/c.jpg']);
});
