/**
 * DEV-ONLY Gemini pilot: a handful of real photos through the REAL authenticated flow (session check, ownership/limits,
 * durable DB quota) with the REAL provider. Records suggested tags, errors, latency and token usage; writes nothing to the
 * wardrobe. Nothing runs without --confirm (default is a dry run that makes NO call).
 *
 *   npx tsx --env-file=.env.verify --env-file=.env.pilot scripts/gemini-pilot.ts            # dry run, no call
 *   npx tsx --env-file=.env.verify --env-file=.env.pilot scripts/gemini-pilot.ts --confirm  # live calls
 *
 * Needs (git-ignored): .env.verify (dev Supabase + synthetic test user A + AI_QUOTA_SERVER_KEY) and .env.pilot (GEMINI_API_KEY,
 * optional GEMINI_MODEL, PILOT_MAX_CALLS). Photos + manifest live in the git-ignored /pilot/ folder (never committed).
 *
 * COST CONTROLS (all enforced in code, in addition to the key-level budget you set at Google):
 *  - at most PILOT_MAX_CALLS provider calls ever (default 5, hard ceiling 8), counted in pilot/.calls BEFORE each call and
 *    persisted, so re-running the script cannot exceed it; delete the file only to start a NEW pilot deliberately;
 *  - the manifest may list at most the same number of photos; no retries; 20 s timeout per call; one call at a time;
 *  - refuses any project other than the development project; refuses a service/secret Supabase key;
 *  - the DB quota (20/day per user) still applies on top.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { analyzePhoto, supabasePhotos, type AnalysisDeps } from '../server/photoAnalysis';
import { supabaseQuota } from '../server/quota';
import { DEFAULT_GEMINI_MODEL, PRICE_PER_M, estimateCostUSD, geminiProvider, type ProviderResult, type Usage } from '../server/gemini';

const env = (k: string) => (process.env[k] ?? '').trim();
const HARD_MAX = 8;
const live = process.argv.includes('--confirm');
const DEV_REF = 'lenqqdflencoxgpcdlrg';

const need = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'EXPECT_PROJECT_REF', 'AI_QUOTA_SERVER_KEY', 'TEST_A_EMAIL', 'TEST_A_PASSWORD', ...(live ? ['GEMINI_API_KEY'] : [])];
if (need.some((k) => !env(k))) { console.log('PENDING: set', need.filter((k) => !env(k)).join(', ')); process.exit(2); }
const URL_ = env('SUPABASE_URL').replace(/\/+$/, '');
if (env('EXPECT_PROJECT_REF') !== DEV_REF || new URL(URL_).hostname !== `${DEV_REF}.supabase.co`) { console.log('REFUSING: the pilot runs against the DEVELOPMENT project only'); process.exit(1); }
if (env('SUPABASE_ANON_KEY').startsWith('sb_secret_')) { console.log('REFUSING: secret Supabase key'); process.exit(1); }
const maxCalls = Math.min(HARD_MAX, Math.max(1, Number(env('PILOT_MAX_CALLS') || 5)));

type Entry = { file: string; expect?: { category?: string; note?: string } };
const dir = 'pilot';
if (!existsSync(`${dir}/manifest.json`)) { console.log(`PENDING: create ${dir}/manifest.json and put the photos in ${dir}/ (see server/README.md)`); process.exit(2); }
const manifest: Entry[] = JSON.parse(readFileSync(`${dir}/manifest.json`, 'utf8'));
if (manifest.length > maxCalls) { console.log(`REFUSING: ${manifest.length} photos listed but the call cap is ${maxCalls}`); process.exit(1); }
const counterFile = `${dir}/.calls`;
const callsSoFar = () => (existsSync(counterFile) ? Number(readFileSync(counterFile, 'utf8')) || 0 : 0);

const model = env('GEMINI_MODEL') || DEFAULT_GEMINI_MODEL;
const perCall = (2000 * PRICE_PER_M.input + 300 * PRICE_PER_M.output) / 1e6; // ~2000 input tokens (4 image tiles + the prompt), ~300 output
console.log(`model ${model} | photos ${manifest.length} | call cap ${maxCalls} (already used: ${callsSoFar()}) | estimated cost ≈ $${(perCall * manifest.length).toFixed(4)} (≈ $${perCall.toFixed(5)}/call; worst case at the cap, doubled ≈ $${(perCall * maxCalls * 2).toFixed(3)})`);
if (!live) { console.log('DRY RUN: no call was made. Re-run with --confirm to make the live calls.'); process.exit(0); }

(async () => {
  const sb = createClient(URL_, env('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: env('TEST_A_EMAIL'), password: env('TEST_A_PASSWORD') });
  if (error || !data.session) throw new Error('sign-in failed');
  const token = data.session.access_token;
  const base = geminiProvider({ apiKey: env('GEMINI_API_KEY'), model });
  let last: Usage | undefined; let lastMs = 0;
  const deps: AnalysisDeps = {
    supabase: { url: URL_, anonKey: env('SUPABASE_ANON_KEY') }, quota: supabaseQuota({ url: URL_, anonKey: env('SUPABASE_ANON_KEY'), serverKey: env('AI_QUOTA_SERVER_KEY') }),
    photos: supabasePhotos({ url: URL_, anonKey: env('SUPABASE_ANON_KEY') }), inFlight: new Set(),
    provider: { async analyze(img, prompt) {
      const used = callsSoFar();
      if (used >= maxCalls) throw new Error('pilot call cap reached');
      writeFileSync(counterFile, String(used + 1)); // counted BEFORE the call
      const r = (await base.analyze(img, prompt)) as ProviderResult;
      last = r.usage; return r;
    } },
    onUsage: (r) => { lastMs = r.ms; },
  };
  const results: any[] = [];
  for (const e of manifest) {
    last = undefined; lastMs = 0;
    const bytes = readFileSync(`${dir}/${e.file}`);
    const out: any = await analyzePhoto(`Bearer ${token}`, { image: bytes.toString('base64') }, deps);
    const rec = { file: e.file, expected: e.expect ?? null, status: out.status, error: out.json?.error ?? null, suggestion: out.json?.suggestion ?? null, latencyMs: lastMs, usage: last ?? null, estCostUSD: estimateCostUSD(last) ?? null };
    results.push(rec);
    console.log(`${rec.file}: HTTP ${rec.status}${rec.error ? ' ' + rec.error : ''} | ${rec.suggestion ? `${rec.suggestion.category}/${rec.suggestion.subtype}/${rec.suggestion.color} flagged[${rec.suggestion.uncertain}]` : '-'} | ${rec.latencyMs} ms | tokens ${JSON.stringify(rec.usage)}`);
  }
  const total = results.reduce((s, r) => s + (r.estCostUSD ?? 0), 0);
  mkdirSync(dir, { recursive: true });
  const f = `${dir}/results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(f, JSON.stringify({ model, results, totalEstCostUSD: total }, null, 2));
  console.log(`calls this pilot: ${callsSoFar()}/${maxCalls}; estimated total cost $${total.toFixed(5)}; results saved to ${f} (git-ignored)`);
})().catch((e) => { console.log('ERROR', e instanceof Error ? e.message : e); process.exit(1); });
