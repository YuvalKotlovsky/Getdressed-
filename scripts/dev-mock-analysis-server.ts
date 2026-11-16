/**
 * DEV ONLY: the real authenticated analysis server (real Supabase session check, real quota, real private storage)
 * with a MOCKED provider, for UI testing. No Gemini call is ever made. Refuses to start against a non-dev ref.
 *   npx tsx --env-file=.env.verify scripts/dev-mock-analysis-server.ts
 * MOCK_MODE_FILE (default /tmp/wmw-mock-mode) holds one word per call: ok | fail | notgarment | slow.
 */
import { readFileSync } from 'node:fs';
import { createServer } from '../server/index';
import { supabaseQuota } from '../server/quota';
import { supabasePhotos } from '../server/photoAnalysis';

const env = (k: string) => (process.env[k] ?? '').trim();
const url = env('SUPABASE_URL').replace(/\/+$/, ''), anonKey = env('SUPABASE_ANON_KEY'), serverKey = env('AI_QUOTA_SERVER_KEY');
if (!url || !anonKey || serverKey.length < 32 || new URL(url).hostname !== `${env('EXPECT_PROJECT_REF')}.supabase.co`) { console.log('REFUSING TO START: SUPABASE_URL / SUPABASE_ANON_KEY / AI_QUOTA_SERVER_KEY / EXPECT_PROJECT_REF missing or inconsistent'); process.exit(1); }
if (env('EXPECT_PROJECT_REF') !== 'lenqqdflencoxgpcdlrg') { console.log('REFUSING TO START: this mock server is for the DEVELOPMENT project only'); process.exit(1); }
const modeFile = env('MOCK_MODE_FILE') || '/tmp/wmw-mock-mode';
const mode = () => { try { return readFileSync(modeFile, 'utf8').trim(); } catch { return 'ok'; } };
// a dress whose colour/occasions the "model" is unsure about -> those fields must come back flagged "לבדיקה"
const DRESS = JSON.stringify({ garment: true, multiple: false, category: 'dress', subtype: 'שמלת מידי', color: 'black', occasions: ['casual'], dressiness: 2, weather: ['mild'], brand: null,
  confidence: { category: 0.95, subtype: 0.9, color: 0.3, occasions: 0.4, dressiness: 0.8, weather: 0.8, brand: 0 } });
const supa = { url, anonKey };
createServer({
  allowedOrigin: env('ALLOWED_ORIGIN') || undefined,
  analysis: { supabase: supa, quota: supabaseQuota({ ...supa, serverKey }), photos: supabasePhotos(supa), inFlight: new Set(),
    provider: { async analyze() {
      const m = mode();
      if (m === 'slow') await new Promise((r) => setTimeout(r, 1500));
      if (m === 'fail') throw new Error('mock upstream failure');
      return m === 'notgarment' ? '{"garment":false}' : DRESS;
    } } },
}).listen(Number(env('PORT') || 8787), '127.0.0.1', () => console.log('mock analysis server on 127.0.0.1 (provider is a MOCK)'));
