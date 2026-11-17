/**
 * LIVE check of the authenticated photo-analysis path against a real Supabase project (development/staging ONLY),
 * with a MOCKED provider (no Gemini call, no cost). Same safety rules as verify-rls.ts: public key only, EXPECT_PROJECT_REF
 * must match the host, two synthetic confirmed accounts.
 *
 *   npx tsx --env-file=.env.verify scripts/verify-photo-analysis.ts
 *
 * It uses real session verification, the real consume_ai_quota RPC and real private storage. The usage rows it creates
 * for the two synthetic users cannot be deleted through RLS (by design); remove them with admin tooling afterwards
 * (see scripts/README-verify-rls.md).
 */
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { analyzePhoto, supabasePhotos, type AnalysisDeps } from '../server/photoAnalysis';
import { supabaseQuota } from '../server/quota';

const env = (k: string) => (process.env[k] ?? '').trim();
const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'EXPECT_PROJECT_REF', 'AI_QUOTA_SERVER_KEY', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'];
if (need.some((k) => !env(k))) { console.log('PENDING: set', need.filter((k) => !env(k)).join(', ')); process.exit(2); }
const URL_ = env('SUPABASE_URL').replace(/\/+$/, ''); const ANON = env('SUPABASE_ANON_KEY');
if (new URL(URL_).hostname !== `${env('EXPECT_PROJECT_REF')}.supabase.co`) { console.log('REFUSING TO RUN: SUPABASE_URL does not match EXPECT_PROJECT_REF'); process.exit(1); }
if (ANON.startsWith('sb_secret_') || /"role":"service_role"/.test(Buffer.from(ANON.split('.')[1] ?? '', 'base64url').toString())) { console.log('REFUSING TO RUN: secret key'); process.exit(1); }
console.log(`Target: ${new URL(URL_).hostname}`);

let passed = 0, failed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e instanceof Error ? e.message : e}`); }
}
const assert = (c: unknown, m: string) => { if (!c) throw new Error(m); };
const client = () => createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function login(email: string, password: string) {
  const sb = client(); const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign-in failed: ${error?.message}`);
  return { sb, id: data.user.id, token: data.session.access_token };
}
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 9)]);
const GARMENT = JSON.stringify({ garment: true, category: 'top', subtype: 'חולצה', color: 'white', occasions: ['casual'], dressiness: 1, weather: ['mild'], confidence: { category: 0.9, subtype: 0.9, color: 0.9, occasions: 0.9, dressiness: 0.9, weather: 0.9 } });
const used = async (sb: SupabaseClient) => ((await sb.from('ai_usage').select('count')).data ?? []).reduce((n, r: any) => n + r.count, 0);

async function main() {
  const A = await login(env('TEST_A_EMAIL'), env('TEST_A_PASSWORD'));
  const B = await login(env('TEST_B_EMAIL'), env('TEST_B_PASSWORD'));
  const supa = { url: URL_, anonKey: ANON };
  const serverKey = env('AI_QUOTA_SERVER_KEY');
  let providerCalls = 0;
  const deps = (): AnalysisDeps => ({
    supabase: supa, quota: supabaseQuota({ ...supa, serverKey }), photos: supabasePhotos(supa), inFlight: new Set(),
    provider: { async analyze() { providerCalls++; return GARMENT; } },
  });
  const bearer = (t: string) => `Bearer ${t}`;

  await check('real session accepted; suggestion returned for review; quota row written for the verified user only', async () => {
    const before = await used(A.sb), beforeB = await used(B.sb);
    const r: any = await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64'), userId: B.id }, deps());
    assert(r.status === 200 && r.json.suggestion.category === 'top', `status ${r.status} ${JSON.stringify(r.json)}`);
    assert((await used(A.sb)) === before + 1, 'A usage did not increase by one');
    assert((await used(B.sb)) === beforeB, 'B usage changed (user id taken from the request?)');
  });

  await check('missing, garbage, tampered and non-bearer credentials are 401 and cost nothing', async () => {
    const p = providerCalls, u = await used(A.sb);
    for (const h of [undefined, 'Bearer ' + 'x'.repeat(40), bearer(A.token.slice(0, -4) + 'abcd'), 'Basic abc']) {
      const r = await analyzePhoto(h, { image: JPEG.toString('base64') }, deps());
      assert(r.status === 401, `status ${r.status}`);
    }
    assert(providerCalls === p && (await used(A.sb)) === u, 'a provider call or quota use happened');
  });

  const mine = `${A.id}/${randomUUID()}/${randomUUID()}.jpg`;
  await check('stored photo: owner can analyze it; another account is refused (403) and storage RLS independently hides it', async () => {
    const up = await A.sb.storage.from('closet-photos').upload(mine, JPEG, { contentType: 'image/jpeg' });
    assert(!up.error, `upload failed: ${up.error?.message}`);
    const ok = await analyzePhoto(bearer(A.token), { photoPath: mine }, deps());
    assert(ok.status === 200, `owner got ${ok.status}`);
    const p = providerCalls, uB = await used(B.sb);
    const no = await analyzePhoto(bearer(B.token), { photoPath: mine }, deps());
    assert(no.status === 403, `B got ${no.status}`);
    assert(providerCalls === p && (await used(B.sb)) === uB, 'cost incurred for a forbidden request');
    // second layer: even bypassing the app-level check, B's token cannot read A's object
    const raw = await supabasePhotos(supa).download({ userId: B.id, token: B.token }, mine, 1_000_000);
    assert(raw === 'not_found', `B read A's object through storage: ${typeof raw === 'string' ? raw : 'bytes'}`);
    await A.sb.storage.from('closet-photos').remove([mine]);
  });

  await check('oversized and non-image uploads are rejected before any quota use', async () => {
    const u = await used(A.sb), p = providerCalls;
    assert((await analyzePhoto(bearer(A.token), { image: Buffer.concat([JPEG, Buffer.alloc(1_600_000)]).toString('base64') }, deps())).status === 413, 'oversize not 413');
    assert((await analyzePhoto(bearer(A.token), { image: Buffer.from('%PDF-1.4 ' + 'x'.repeat(100)).toString('base64') }, deps())).status === 415, 'pdf not 415');
    assert((await used(A.sb)) === u && providerCalls === p, 'quota/provider touched');
  });

  await check('quota: FIXED in the database (20/day), exhausted -> 429 with no provider call; durable; B unaffected; counters not editable', async () => {
    const start = await used(A.sb);
    const p = providerCalls;
    let ok = 0, last: any;
    for (let i = 0; i < 25 && ok < 25; i++) { last = await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64') }, deps()); if (last.status !== 200) break; ok++; }
    assert(last.status === 429 && last.json.scope === 'day', `expected the 429 day ceiling, got ${last.status} ${JSON.stringify(last.json)}`);
    assert(start + ok === 20, `ceiling reached after ${start + ok} uses (expected the fixed 20)`);
    assert(providerCalls === p + ok, 'provider was called after exhaustion');
    assert((await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64') }, deps())).status === 429, 'not durable across instances');
    assert((await analyzePhoto(bearer(B.token), { image: JPEG.toString('base64') }, deps())).status === 200, 'B blocked by A usage');
    const ins = await A.sb.from('ai_usage').insert({ user_id: A.id, day: '2000-01-01', kind: 'analyze_photo', count: 0 });
    const upd = await A.sb.from('ai_usage').update({ count: 0 }).eq('user_id', A.id).select();
    const del = await A.sb.from('ai_usage').delete().eq('user_id', A.id).select();
    assert(ins.error, 'insert allowed'); assert((upd.data ?? []).length === 0, 'update changed rows'); assert((del.data ?? []).length === 0, 'delete removed rows');
    assert((await used(A.sb)) === 20, 'counter was reset or changed');
  });

  await check('QUOTA IS SERVER-ONLY: a verified user calling the RPC directly (no key / wrong key) is refused and nothing is consumed', async () => {
    const before = await used(A.sb);
    const direct = await A.sb.rpc('consume_ai_quota', { p_kind: 'analyze_photo' });
    assert(direct.error, 'direct call without the server key was accepted');
    const wrong = await fetch(`${URL_}/rest/v1/rpc/consume_ai_quota`, { method: 'POST', headers: { authorization: `Bearer ${A.token}`, apikey: ANON, 'content-type': 'application/json', 'x-ai-server-key': 'x'.repeat(40) }, body: JSON.stringify({ p_kind: 'analyze_photo' }) });
    assert(!wrong.ok, 'wrong server key accepted');
    const right = await fetch(`${URL_}/rest/v1/rpc/consume_ai_quota`, { method: 'POST', headers: { apikey: ANON, 'x-ai-server-key': serverKey, 'content-type': 'application/json' }, body: JSON.stringify({ p_kind: 'analyze_photo' }) });
    assert(!right.ok, 'the server key without a user session was accepted');
    assert((await used(A.sb)) === before, 'quota changed during refused calls');
  });

  await check('RPC guards: anonymous refused; unknown kind refused; callers cannot choose limits; limits table and key table unreadable; direct calls change nothing', async () => {
    const anon = client();
    assert((await anon.rpc('consume_ai_quota', { p_kind: 'analyze_photo' })).error, 'anon could call the RPC');
    assert((await A.sb.rpc('consume_ai_quota', { p_kind: 'other' })).error, 'unknown kind accepted');
    const old = await A.sb.rpc('consume_ai_quota', { p_kind: 'analyze_photo', p_day_limit: 10000, p_month_limit: 100000, p_global_day_limit: 1000000 });
    assert(old.error, 'the old limit-taking signature still exists');
    const lim = await A.sb.from('ai_quota_limits').select('*');
    assert(lim.error || (lim.data ?? []).length === 0, 'limits table readable by users');
    // A is already at the fixed daily cap: direct RPC calls cannot add more, so one account cannot inflate the global count
    const before = await used(A.sb);
    for (let i = 0; i < 5; i++) { const r: any = await A.sb.rpc('consume_ai_quota', { p_kind: 'analyze_photo' }); assert(r.error, 'direct call was accepted'); }
    assert((await A.sb.from('ai_quota_server_keys').select('*')).error || true, 'n/a');
    const keys = await A.sb.from('ai_quota_server_keys').select('*');
    assert(keys.error || (keys.data ?? []).length === 0, 'server key table readable by users');
    assert((await used(A.sb)) === before, 'direct calls changed the counter');
  });

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed (provider was a mock; Gemini was never called)`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log('ERROR', e instanceof Error ? e.message : e); process.exit(1); });
