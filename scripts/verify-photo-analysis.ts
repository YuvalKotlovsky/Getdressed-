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
const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'EXPECT_PROJECT_REF', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'];
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
  let providerCalls = 0;
  const deps = (limits = { perDay: 1000, perMonth: 10000, globalPerDay: 100000 }): AnalysisDeps => ({
    supabase: supa, quota: supabaseQuota(supa), photos: supabasePhotos(supa), limits, inFlight: new Set(),
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

  await check('quota: durable, per user, exhausted -> 429 with no provider call; B unaffected; direct table writes denied', async () => {
    const start = await used(A.sb);
    const limits = { perDay: start + 2, perMonth: 100000, globalPerDay: 1000000 };
    const p = providerCalls;
    assert((await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64') }, deps(limits))).status === 200, '1st');
    assert((await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64') }, deps(limits))).status === 200, '2nd');
    const third: any = await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64') }, deps(limits));
    assert(third.status === 429 && third.json.scope === 'day', `3rd: ${third.status} ${JSON.stringify(third.json)}`);
    assert(providerCalls === p + 2, 'provider was called after exhaustion');
    // the counter lives in the database: a brand-new server instance (fresh deps) still sees it
    assert((await analyzePhoto(bearer(A.token), { image: JPEG.toString('base64') }, deps(limits))).status === 429, 'not durable');
    assert((await analyzePhoto(bearer(B.token), { image: JPEG.toString('base64') }, deps({ perDay: (await used(B.sb)) + 1, perMonth: 100000, globalPerDay: 1000000 }))).status === 200, 'B blocked by A usage');
    // a user cannot edit counters directly
    const ins = await A.sb.from('ai_usage').insert({ user_id: A.id, day: '2000-01-01', kind: 'analyze_photo', count: 0 });
    const upd = await A.sb.from('ai_usage').update({ count: 0 }).eq('user_id', A.id).select();
    const del = await A.sb.from('ai_usage').delete().eq('user_id', A.id).select();
    assert(ins.error, 'insert allowed'); assert((upd.data ?? []).length === 0, 'update changed rows'); assert((del.data ?? []).length === 0, 'delete removed rows');
    assert((await used(A.sb)) >= start + 2, 'counter was reset');
  });

  await check('RPC guards: anonymous caller, bad limits and unknown kind are refused', async () => {
    const anon = client();
    const r1 = await anon.rpc('consume_ai_quota', { p_kind: 'analyze_photo', p_day_limit: 5, p_month_limit: 5, p_global_day_limit: 5 });
    assert(r1.error, 'anon could call the RPC');
    const r2 = await A.sb.rpc('consume_ai_quota', { p_kind: 'analyze_photo', p_day_limit: 0, p_month_limit: 5, p_global_day_limit: 5 });
    assert(r2.error, 'zero limit accepted');
    const r3 = await A.sb.rpc('consume_ai_quota', { p_kind: 'other', p_day_limit: 5, p_month_limit: 5, p_global_day_limit: 5 });
    assert(r3.error, 'unknown kind accepted');
  });

  console.log(`\nSUMMARY: ${passed} passed, ${failed} failed (provider was a mock; Gemini was never called)`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log('ERROR', e instanceof Error ? e.message : e); process.exit(1); });
