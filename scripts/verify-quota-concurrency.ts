/**
 * LIVE concurrency check of the quota against the dev database, mocked provider (no Gemini). Fires many simultaneous
 * analysis requests from two real accounts and checks that the database admits EXACTLY the allowed number (no overshoot).
 * Expects fresh usage for the two synthetic users and a known ceiling: set EXPECT_DAY (default 20) and optionally
 * EXPECT_GLOBAL (e.g. after temporarily lowering ai_quota_limits.global_per_day with admin tooling). Dev only.
 *   npx tsx --env-file=.env.verify scripts/verify-quota-concurrency.ts
 */
import { createClient } from '@supabase/supabase-js';
import { analyzePhoto, supabasePhotos, type AnalysisDeps } from '../server/photoAnalysis';
import { supabaseQuota } from '../server/quota';

const env = (k: string) => (process.env[k] ?? '').trim();
const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'EXPECT_PROJECT_REF', 'AI_QUOTA_SERVER_KEY', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', 'TEST_B_EMAIL', 'TEST_B_PASSWORD'];
if (need.some((k) => !env(k))) { console.log('PENDING: set', need.filter((k) => !env(k)).join(', ')); process.exit(2); }
const URL_ = env('SUPABASE_URL').replace(/\/+$/, '');
if (new URL(URL_).hostname !== `${env('EXPECT_PROJECT_REF')}.supabase.co`) { console.log('REFUSING TO RUN: SUPABASE_URL does not match EXPECT_PROJECT_REF'); process.exit(1); }
const login = async (e: string, p: string) => {
  const sb = createClient(URL_, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: e, password: p });
  if (error || !data.session) throw new Error('sign-in failed');
  return { sb, token: data.session.access_token };
};
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 9)]).toString('base64');
const GARMENT = JSON.stringify({ garment: true, category: 'top', subtype: 'חולצה', color: 'white', occasions: ['casual'], dressiness: 1, weather: ['mild'], confidence: {} });
(async () => {
  const A = await login(env('TEST_A_EMAIL'), env('TEST_A_PASSWORD')), B = await login(env('TEST_B_EMAIL'), env('TEST_B_PASSWORD'));
  const supa = { url: URL_, anonKey: env('SUPABASE_ANON_KEY') };
  let provider = 0;
  const deps = (): AnalysisDeps => ({ supabase: supa, quota: supabaseQuota({ ...supa, serverKey: env('AI_QUOTA_SERVER_KEY') }), photos: supabasePhotos(supa), inFlight: new Set(), provider: { async analyze() { provider++; return GARMENT; } } });
  const N = 30;
  const t0 = Date.now();
  // 30 simultaneous requests per account, from DIFFERENT "server instances" (separate deps, so the in-process busy guard cannot hide a database race)
  const results = await Promise.all([
    ...Array.from({ length: N }, () => analyzePhoto(`Bearer ${A.token}`, { image: JPEG }, deps()).then((r) => ({ who: 'A', r }))),
    ...Array.from({ length: N }, () => analyzePhoto(`Bearer ${B.token}`, { image: JPEG }, deps()).then((r) => ({ who: 'B', r }))),
  ]);
  const count = (who: string, f: (s: number, j: any) => boolean) => results.filter((x) => x.who === who && f(x.r.status, x.r.json)).length;
  const okA = count('A', (s) => s === 200), okB = count('B', (s) => s === 200);
  const deniedA = count('A', (s, j) => s === 429 && j.error === 'quota_exceeded'), deniedB = count('B', (s, j) => s === 429 && j.error === 'quota_exceeded');
  const other = results.filter((x) => ![200, 429].includes(x.r.status)).map((x) => x.r.status);
  const usedA = ((await A.sb.from('ai_usage').select('count')).data ?? []).reduce((n: number, r: any) => n + r.count, 0);
  const usedB = ((await B.sb.from('ai_usage').select('count')).data ?? []).reduce((n: number, r: any) => n + r.count, 0);
  console.log(`A: ${okA} allowed / ${deniedA} denied (db count ${usedA}); B: ${okB} allowed / ${deniedB} denied (db count ${usedB}); provider calls ${provider}; other statuses [${other}]; ${Date.now() - t0} ms`);
  const day = Number(env('EXPECT_DAY') || 20), glob = env('EXPECT_GLOBAL') ? Number(env('EXPECT_GLOBAL')) : undefined;
  let ok = other.length === 0 && provider === okA + okB && usedA === okA && usedB === okB;
  if (glob === undefined) ok = ok && okA === day && okB === day;
  else ok = ok && okA + okB === glob && okA <= day && okB <= day;
  console.log(ok ? 'PASS  concurrent requests never exceed the ceiling; provider calls == admitted requests' : 'FAIL  quota overshoot or inconsistency');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ERROR', e instanceof Error ? e.message : e); process.exit(1); });
