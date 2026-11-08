/**
 * Live cross-account check of the Supabase RLS + storage policies (table wardrobe_items, bucket closet-photos).
 *
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   TEST_A_EMAIL=... TEST_A_PASSWORD=... TEST_B_EMAIL=... TEST_B_PASSWORD=... \
 *   [TEST_UNVERIFIED_EMAIL=... TEST_UNVERIFIED_PASSWORD=...] [TEST_B_EXPECT_EMPTY=1] \
 *   npx tsx scripts/verify-rls.ts
 *
 * Uses ONLY the anon key plus pre-created, email-verified test users (never the service-role key).
 * Creates its own rows/objects under random uuids and removes them at the end.
 * Exit codes: 0 all passed, 1 at least one check failed, 2 PENDING (not configured; nothing was checked).
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'] as const;
const env = (k: string) => (process.env[k] ?? '').trim();

const missing = REQUIRED.filter((k) => !env(k));
// Guard against pointing the checks at the wrong project: the host must belong to the project ref you name.
const EXPECT_REF = env('EXPECT_PROJECT_REF');
if (missing.length) {
  console.log('PENDING: live checks did not run. Nothing was verified.');
  console.log('Set these environment variables (see scripts/README-verify-rls.md):');
  for (const k of missing) console.log(`  - ${k}`);
  console.log('Also required for a hosted project: EXPECT_PROJECT_REF (the DEVELOPMENT project ref; SUPABASE_URL must be https://<ref>.supabase.co).');
  console.log('Optional: TEST_UNVERIFIED_EMAIL, TEST_UNVERIFIED_PASSWORD, TEST_B_EXPECT_EMPTY=1');
  process.exit(2);
}

const URL_ = env('SUPABASE_URL').replace(/\/+$/, '');
{
  let host = '';
  try { host = new URL(URL_).hostname; } catch {}
  const local = host === 'localhost' || host === '127.0.0.1';
  if (!local && (!EXPECT_REF || host !== `${EXPECT_REF}.supabase.co`)) {
    console.log(`REFUSING TO RUN: set EXPECT_PROJECT_REF to the DEVELOPMENT project ref and make SUPABASE_URL match it (target host: ${host || 'invalid'}).`);
    process.exit(1);
  }
  console.log(`Target: ${host}${local ? ' (local)' : ' (matches EXPECT_PROJECT_REF)'}`);
}
const ANON = env('SUPABASE_ANON_KEY');
const BUCKET = 'closet-photos';
const TABLE = 'wardrobe_items';

function jwtRole(token: string): string | null {
  try { return (JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { role?: string }).role ?? null; } catch { return null; }
}
if (ANON.startsWith('sb_secret_') || jwtRole(ANON) === 'service_role') {
  console.log('REFUSING TO RUN: SUPABASE_ANON_KEY is a secret / service-role key. Use the public anon key.');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// tiny harness
// ---------------------------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed++;
    const m = e instanceof Error ? e.message : String(e);
    failures.push(`${name}: ${m}`);
    console.log(`FAIL  ${name}\n      ${m}`);
  }
}
const assert = (cond: unknown, msg: string): void => { if (!cond) throw new Error(msg); };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function newClient(): SupabaseClient {
  return createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function signedIn(email: string, password: string): Promise<{ sb: SupabaseClient; id: string; confirmed: boolean }> {
  const sb = newClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw new Error(`sign-in failed for ${email}: ${error?.message ?? 'no user'}`);
  return { sb, id: data.user.id, confirmed: !!data.user.email_confirmed_at };
}

/** A minimal JPEG-looking payload. The bucket checks the declared content type, not the pixels. */
const jpegBytes = (marker: number, size = 64): Uint8Array => {
  const b = new Uint8Array(size).fill(marker);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[size - 2] = 0xff; b[size - 1] = 0xd9;
  return b;
};
const JPEG = { contentType: 'image/jpeg' };

async function bytesOf(blob: Blob): Promise<number[]> { return Array.from(new Uint8Array(await blob.arrayBuffer())); }

// ---------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  const A = await signedIn(env('TEST_A_EMAIL'), env('TEST_A_PASSWORD'));
  const B = await signedIn(env('TEST_B_EMAIL'), env('TEST_B_PASSWORD'));
  assert(A.id !== B.id, 'TEST_A and TEST_B must be different users');
  assert(A.confirmed && B.confirmed, 'TEST_A and TEST_B must be email-verified users');
  console.log(`Users: A=${A.id}  B=${B.id}\n`);

  const itemA = randomUUID();
  const photoA = `${A.id}/${itemA}/${randomUUID()}.jpg`;
  const bytesA = jpegBytes(0x41);
  const itemB = randomUUID();
  const createdPaths: { sb: SupabaseClient; path: string }[] = [];
  const createdRows: { sb: SupabaseClient; id: string }[] = [];

  // -- brand-new account sees nothing (runs before B creates anything) ------------------------
  await check('B (nothing created yet) sees no rows of any other account', async () => {
    const { data, error } = await B.sb.from(TABLE).select('id,user_id');
    assert(!error, `select failed: ${error?.message}`);
    const foreign = (data ?? []).filter((r) => r.user_id !== B.id);
    assert(foreign.length === 0, `B can see ${foreign.length} foreign row(s)`);
    if (env('TEST_B_EXPECT_EMPTY') === '1') assert((data ?? []).length === 0, `B expected to be empty but has ${data?.length} row(s)`);
  });

  // -- A: own data ------------------------------------------------------------------------------
  await check('A inserts own item (user_id defaults to auth.uid, updated_at is server-set)', async () => {
    const { data, error } = await A.sb.from(TABLE)
      .insert({ id: itemA, data: { name: 'A-shirt', category: 'shirts' }, updated_at: '2001-01-01T00:00:00Z' })
      .select('id,user_id,updated_at,deleted_at').single();
    assert(!error, `insert failed: ${error?.message}`);
    createdRows.push({ sb: A.sb, id: itemA });
    assert(data!.user_id === A.id, `user_id is ${data!.user_id}, expected A`);
    assert(new Date(data!.updated_at).getFullYear() >= 2024, `client-supplied updated_at was accepted: ${data!.updated_at}`);
  });

  await check('A selects own item', async () => {
    const { data, error } = await A.sb.from(TABLE).select('id,data').eq('id', itemA);
    assert(!error && data?.length === 1, `expected 1 row, got ${data?.length} (${error?.message ?? 'no error'})`);
  });

  await check('A updates own item', async () => {
    const { data, error } = await A.sb.from(TABLE).update({ data: { name: 'A-shirt-2' } }).eq('id', itemA).select('data');
    assert(!error && data?.length === 1 && (data[0].data as { name: string }).name === 'A-shirt-2', `update not applied (${error?.message ?? ''})`);
  });

  await check('A cannot reassign user_id to B (update)', async () => {
    const { data, error } = await A.sb.from(TABLE).update({ user_id: B.id }).eq('id', itemA).select('id');
    assert(error || (data ?? []).length === 0, 'update of user_id was accepted');
    const { data: still } = await A.sb.from(TABLE).select('user_id').eq('id', itemA).single();
    assert(still?.user_id === A.id, 'row owner changed');
  });

  await check('A uploads own photo at {A}/{item}/{photo}.jpg', async () => {
    const { error } = await A.sb.storage.from(BUCKET).upload(photoA, bytesA, JPEG);
    assert(!error, `upload failed: ${error?.message}`);
    createdPaths.push({ sb: A.sb, path: photoA });
  });

  await check('A links the photo on the row (photo_path in own folder accepted)', async () => {
    const { error } = await A.sb.from(TABLE).update({ photo_path: photoA }).eq('id', itemA);
    assert(!error, `update failed: ${error?.message}`);
  });

  await check('A downloads own photo (bytes identical)', async () => {
    const { data, error } = await A.sb.storage.from(BUCKET).download(photoA);
    assert(!error && data, `download failed: ${error?.message}`);
    assert(same(await bytesOf(data!), Array.from(bytesA)), 'downloaded bytes differ');
  });

  await check('A creates a signed URL for own photo and it serves the bytes', async () => {
    const { data, error } = await A.sb.storage.from(BUCKET).createSignedUrl(photoA, 60);
    assert(!error && data?.signedUrl, `signed url failed: ${error?.message}`);
    const r = await fetch(data!.signedUrl);
    assert(r.ok, `signed url fetch status ${r.status}`);
    assert(same(Array.from(new Uint8Array(await r.arrayBuffer())), Array.from(bytesA)), 'signed url bytes differ');
  });

  await check('A uploads a rejected type (text/plain) -> denied', async () => {
    const p = `${A.id}/${itemA}/${randomUUID()}.jpg`;
    const { error } = await A.sb.storage.from(BUCKET).upload(p, new Uint8Array([104, 105]), { contentType: 'text/plain' });
    if (!error) createdPaths.push({ sb: A.sb, path: p });
    assert(error, 'non-image mime type was accepted');
  });

  await check('A uploads > 5 MB -> denied', async () => {
    const p = `${A.id}/${itemA}/${randomUUID()}.jpg`;
    const { error } = await A.sb.storage.from(BUCKET).upload(p, jpegBytes(0x42, 5 * 1024 * 1024 + 1), JPEG);
    if (!error) createdPaths.push({ sb: A.sb, path: p });
    assert(error, 'oversized object was accepted');
  });

  await check('A row with photo_path in another user\'s folder -> rejected by constraint', async () => {
    const { error } = await A.sb.from(TABLE).insert({ id: randomUUID(), data: {}, photo_path: `${B.id}/${randomUUID()}/x.jpg` });
    assert(error, 'photo_path into B\'s folder was accepted');
  });

  await check('A rejects non-object data and oversized data (constraints)', async () => {
    const r1 = await A.sb.from(TABLE).insert({ id: randomUUID(), data: [1, 2, 3] });
    assert(r1.error, 'array data accepted');
    const r2 = await A.sb.from(TABLE).insert({ id: randomUUID(), data: { blob: 'x'.repeat(25000) } });
    assert(r2.error, '>20KB data accepted');
  });

  await check('A signed in on a SECOND client session sees the item and photo (cross-session)', async () => {
    const A2 = await signedIn(env('TEST_A_EMAIL'), env('TEST_A_PASSWORD'));
    const { data, error } = await A2.sb.from(TABLE).select('id,photo_path').eq('id', itemA);
    assert(!error && data?.length === 1 && data[0].photo_path === photoA, `second session does not see the item (${error?.message ?? ''})`);
    const dl = await A2.sb.storage.from(BUCKET).download(photoA);
    assert(!dl.error, `second session cannot download: ${dl.error?.message}`);
    await A2.sb.auth.signOut();
  });

  // -- B vs A's rows --------------------------------------------------------------------------
  await check('B select of A\'s row returns nothing', async () => {
    const { data, error } = await B.sb.from(TABLE).select('id').eq('id', itemA);
    assert(!error, `select errored: ${error?.message}`);
    assert((data ?? []).length === 0, 'B can read A\'s row');
    const all = await B.sb.from(TABLE).select('id,user_id');
    assert((all.data ?? []).every((r) => r.user_id === B.id), 'B listing contains foreign rows');
  });

  await check('B insert with user_id = A is denied', async () => {
    const id = randomUUID();
    const { error } = await B.sb.from(TABLE).insert({ id, user_id: A.id, data: { evil: true } });
    if (!error) createdRows.push({ sb: A.sb, id });
    assert(error, 'B inserted a row owned by A');
  });

  await check('B update of A\'s row affects nothing; A\'s row unchanged', async () => {
    const { data, error } = await B.sb.from(TABLE).update({ data: { name: 'HACKED' }, deleted_at: new Date().toISOString() }).eq('id', itemA).select('id');
    assert(error || (data ?? []).length === 0, 'B updated A\'s row');
    const { data: row } = await A.sb.from(TABLE).select('data,deleted_at').eq('id', itemA).single();
    assert((row?.data as { name?: string })?.name === 'A-shirt-2' && row?.deleted_at === null, `A's row changed: ${JSON.stringify(row)}`);
  });

  await check('B delete of A\'s row affects nothing; row still exists', async () => {
    const { data, error } = await B.sb.from(TABLE).delete().eq('id', itemA).select('id');
    assert(error || (data ?? []).length === 0, 'B deleted A\'s row');
    const { data: row } = await A.sb.from(TABLE).select('id').eq('id', itemA);
    assert(row?.length === 1, 'A\'s row is gone');
  });

  await check('B upsert with A\'s item id does not overwrite or take over', async () => {
    const { error } = await B.sb.from(TABLE).upsert({ id: itemA, data: { name: 'TAKEOVER' }, photo_path: null }, { onConflict: 'id' });
    // Either an RLS error or a silent no-op is acceptable; the stored row must be untouched.
    void error;
    const { data: row } = await A.sb.from(TABLE).select('user_id,data,photo_path').eq('id', itemA).single();
    assert(row?.user_id === A.id, `ownership changed to ${row?.user_id}`);
    assert((row?.data as { name?: string })?.name === 'A-shirt-2' && row?.photo_path === photoA, `A's row was overwritten: ${JSON.stringify(row)}`);
  });

  await check('B cannot set photo_path into A\'s folder on its own row (constraint)', async () => {
    const own = await B.sb.from(TABLE).insert({ id: itemB, data: { name: 'B-item' } });
    assert(!own.error, `B could not create its own item: ${own.error?.message}`);
    createdRows.push({ sb: B.sb, id: itemB });
    const r1 = await B.sb.from(TABLE).update({ photo_path: photoA }).eq('id', itemB);
    assert(r1.error, 'photo_path pointing at A\'s object was accepted (update)');
    const r2 = await B.sb.from(TABLE).insert({ id: randomUUID(), data: {}, photo_path: photoA });
    assert(r2.error, 'photo_path pointing at A\'s object was accepted (insert)');
    const r3 = await B.sb.from(TABLE).update({ photo_path: `${B.id}/${itemB}/../../${A.id}/${itemA}/x.jpg` }).eq('id', itemB);
    assert(r3.error, 'path traversal in photo_path was accepted');
  });

  // -- B vs A's storage ---------------------------------------------------------------------
  const stillIntact = async (label: string) => {
    const { data, error } = await A.sb.storage.from(BUCKET).download(photoA);
    assert(!error && data && same(await bytesOf(data), Array.from(bytesA)), `A's object damaged after ${label}`);
  };

  await check('B download of A\'s object is denied', async () => {
    const { data, error } = await B.sb.storage.from(BUCKET).download(photoA);
    assert(error && !data, 'B downloaded A\'s photo');
  });

  await check('B createSignedUrl for A\'s object is denied', async () => {
    const { data, error } = await B.sb.storage.from(BUCKET).createSignedUrl(photoA, 60);
    assert(error || !data?.signedUrl, 'B got a signed URL for A\'s photo');
  });

  await check('B list of A\'s folder is empty/denied', async () => {
    const { data, error } = await B.sb.storage.from(BUCKET).list(`${A.id}/${itemA}`);
    assert(error || (data ?? []).length === 0, `B listed ${data?.length} object(s) of A`);
    const top = await B.sb.storage.from(BUCKET).list(A.id);
    assert(top.error || (top.data ?? []).length === 0, 'B can list A\'s top-level folder');
    const root = await B.sb.storage.from(BUCKET).list('');
    assert(root.error || !(root.data ?? []).some((o) => o.name === A.id), 'B sees A\'s folder at bucket root');
  });

  await check('B remove of A\'s object affects nothing', async () => {
    const { data } = await B.sb.storage.from(BUCKET).remove([photoA]);
    assert((data ?? []).length === 0, 'B removed A\'s object');
    await stillIntact('B remove');
  });

  await check('B overwrite-upload (upsert) onto A\'s object path is denied; A object intact', async () => {
    const { error } = await B.sb.storage.from(BUCKET).upload(photoA, jpegBytes(0x58), { ...JPEG, upsert: true });
    assert(error, 'B overwrote A\'s object');
    await stillIntact('B overwrite');
  });

  await check('B upload of a NEW object into A\'s folder is denied', async () => {
    const p = `${A.id}/${itemA}/${randomUUID()}.jpg`;
    const { error } = await B.sb.storage.from(BUCKET).upload(p, jpegBytes(0x59), JPEG);
    if (!error) createdPaths.push({ sb: A.sb, path: p });
    assert(error, 'B uploaded into A\'s folder');
  });

  await check('B can use its OWN folder (sanity: denial above is not a blanket failure)', async () => {
    const p = `${B.id}/${itemB}/${randomUUID()}.jpg`;
    const { error } = await B.sb.storage.from(BUCKET).upload(p, jpegBytes(0x43), JPEG);
    assert(!error, `B upload to own folder failed: ${error?.message}`);
    createdPaths.push({ sb: B.sb, path: p });
  });

  // -- anonymous --------------------------------------------------------------------------------
  const anon = newClient();
  await check('anon (no session) cannot select or insert rows', async () => {
    const sel = await anon.from(TABLE).select('id').eq('id', itemA);
    assert(sel.error || (sel.data ?? []).length === 0, 'anon can read rows');
    const ins = await anon.from(TABLE).insert({ id: randomUUID(), user_id: A.id, data: {} });
    assert(ins.error, 'anon inserted a row');
  });

  await check('anon cannot download, sign or list storage objects', async () => {
    const dl = await anon.storage.from(BUCKET).download(photoA);
    assert(dl.error && !dl.data, 'anon downloaded the object');
    const su = await anon.storage.from(BUCKET).createSignedUrl(photoA, 60);
    assert(su.error || !su.data?.signedUrl, 'anon got a signed URL');
    const ls = await anon.storage.from(BUCKET).list(`${A.id}/${itemA}`);
    assert(ls.error || (ls.data ?? []).length === 0, 'anon can list the folder');
  });

  await check('public URL of the object fails (bucket is private)', async () => {
    const { data } = anon.storage.from(BUCKET).getPublicUrl(photoA);
    const r = await fetch(data.publicUrl);
    assert(!r.ok, `public URL served the object (status ${r.status})`);
  });

  await check('anon cannot upload', async () => {
    const { error } = await anon.storage.from(BUCKET).upload(`${A.id}/${itemA}/${randomUUID()}.jpg`, jpegBytes(0x44), JPEG);
    assert(error, 'anon upload accepted');
  });

  // -- unverified user (optional) -----------------------------------------------------------
  if (env('TEST_UNVERIFIED_EMAIL') && env('TEST_UNVERIFIED_PASSWORD')) {
    await check('unverified user is denied (sign-in, or table + storage if a session is issued)', async () => {
      const sb = newClient();
      const { data, error } = await sb.auth.signInWithPassword({ email: env('TEST_UNVERIFIED_EMAIL'), password: env('TEST_UNVERIFIED_PASSWORD') });
      if (error || !data.session) {
        // Blocked at the auth layer. This does NOT exercise the SQL policy (see README).
        console.log(`      note: sign-in refused (${error?.code ?? error?.message}); policy-level denial not exercised`);
        return;
      }
      assert(!data.user.email_confirmed_at, 'TEST_UNVERIFIED user is actually verified; use an unconfirmed user');
      const uid = data.user.id;
      const ins = await sb.from(TABLE).insert({ id: randomUUID(), data: {} });
      assert(ins.error, 'unverified user inserted a row');
      const sel = await sb.from(TABLE).select('id');
      assert(sel.error || (sel.data ?? []).length === 0, 'unverified user can read rows');
      const up = await sb.storage.from(BUCKET).upload(`${uid}/${randomUUID()}/${randomUUID()}.jpg`, jpegBytes(0x45), JPEG);
      assert(up.error, 'unverified user uploaded a photo');
      const dl = await sb.storage.from(BUCKET).download(photoA);
      assert(dl.error, 'unverified user downloaded a photo');
      await sb.auth.signOut();
    });
  } else {
    console.log('SKIP  unverified-user checks (TEST_UNVERIFIED_EMAIL / TEST_UNVERIFIED_PASSWORD not set)');
  }

  // -- A soft-deletes; B/A views --------------------------------------------------------------
  await check('A soft-deletes own item (deleted_at set, row still readable as a tombstone)', async () => {
    const { error } = await A.sb.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', itemA);
    assert(!error, `soft delete failed: ${error?.message}`);
    const { data } = await A.sb.from(TABLE).select('deleted_at').eq('id', itemA).single();
    assert(data?.deleted_at, 'deleted_at not set');
  });

  // -- delete wins: a stale edit from another client must not resurrect a deleted item ---------------
  //    (needs migration 20261108000000_wardrobe_items_tombstone_terminal.sql)
  await check('DELETE WINS: two clients load an item, one deletes, the other\'s stale edit is rejected and the item stays deleted', async () => {
    const A2 = await signedIn(env('TEST_A_EMAIL'), env('TEST_A_PASSWORD'));
    const itemC = randomUUID();
    const ins = await A.sb.from(TABLE).insert({ id: itemC, data: { name: 'original' } });
    assert(!ins.error, `setup insert failed: ${ins.error?.message}`);
    createdRows.push({ sb: A.sb, id: itemC });
    const seen = await A2.sb.from(TABLE).select('id,data').eq('id', itemC).single();
    assert(seen.data?.id === itemC, 'client 2 could not load the item');
    const del = await A.sb.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', itemC);
    assert(!del.error, `delete failed: ${del.error?.message}`);

    const hint = ' (apply migration 20261108000000_wardrobe_items_tombstone_terminal.sql to this project)';
    const stale = await A2.sb.from(TABLE).upsert({ id: itemC, data: { name: 'stale edit' }, photo_path: null, deleted_at: null }, { onConflict: 'id' });
    assert(stale.error && /item_deleted/.test(stale.error.message), `stale upsert was not rejected with item_deleted${hint}`);
    const editOnly = await A2.sb.from(TABLE).update({ data: { name: 'stale edit 2' } }).eq('id', itemC);
    assert(editOnly.error && /item_deleted/.test(editOnly.error.message), `stale data update was not rejected${hint}`);
    const restore = await A2.sb.from(TABLE).update({ deleted_at: null }).eq('id', itemC);
    assert(restore.error && /item_deleted/.test(restore.error.message), `clearing deleted_at was not rejected${hint}`);

    for (const [who, sb] of [['client 1', A.sb], ['client 2', A2.sb]] as const) {
      const r = await sb.from(TABLE).select('data,deleted_at').eq('id', itemC).single();
      assert(r.data?.deleted_at, `${who}: item is no longer deleted`);
      assert((r.data?.data as { name?: string })?.name === 'original', `${who}: stale edit changed the record`);
    }
    const before = (await A.sb.from(TABLE).select('deleted_at').eq('id', itemC).single()).data?.deleted_at;
    const again = await A2.sb.from(TABLE).update({ deleted_at: new Date().toISOString() }).eq('id', itemC);
    assert(!again.error, `repeating the delete failed: ${again.error?.message}`);
    const after = (await A.sb.from(TABLE).select('deleted_at').eq('id', itemC).single()).data?.deleted_at;
    assert(before === after, 'repeating the delete moved deleted_at');
    await A2.sb.auth.signOut();
  });

  // -- cleanup -------------------------------------------------------------------------------------
  console.log('\nCleaning up test data...');
  for (const { sb, path } of createdPaths) {
    const { error } = await sb.storage.from(BUCKET).remove([path]);
    if (error) console.log(`      cleanup warning (object ${path}): ${error.message}`);
  }
  for (const { sb, id } of createdRows) {
    const { error } = await sb.from(TABLE).delete().eq('id', id);
    if (error) console.log(`      cleanup warning (row ${id}): ${error.message}`);
  }
  // Verify the cleanup really removed what A created.
  const left = await A.sb.from(TABLE).select('id').eq('id', itemA);
  if ((left.data ?? []).length) console.log(`      cleanup warning: row ${itemA} still exists`);

  await A.sb.auth.signOut();
  await B.sb.auth.signOut();
}

main()
  .catch((e) => {
    failed++;
    failures.push(`setup/runtime: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`FAIL  setup/runtime\n      ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(() => {
    console.log(`\nSUMMARY: ${passed} passed, ${failed} failed`);
    if (failed) {
      for (const f of failures) console.log(` - ${f}`);
      process.exit(1);
    }
    console.log('All live checks passed against the configured project.');
    process.exit(0);
  });
