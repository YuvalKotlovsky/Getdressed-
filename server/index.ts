/**
 * Photo recognition proxy. Keeps the Anthropic API key on the server.
 *   ANTHROPIC_API_KEY=... npm run server        (PORT, ALLOWED_ORIGIN, RECOGNITION_MODEL optional)
 * The app sends ONE resized garment photo; nothing is stored or logged here.
 */
import http from 'node:http';
import { RECOGNITION_PROMPT, extractJson, normalizeRecognition } from '../src/tagging/schema';
import { RECEIPT_PROMPT, normalizeReceipt } from '../src/import/receiptSchema';
import { fetchProduct } from './product';
import { analyzePhoto, MAX_BODY_BYTES, supabasePhotos, type AnalysisDeps } from './photoAnalysis';
import { geminiProvider } from './gemini';
import { supabaseQuota } from './quota';
import { verifySession } from './auth';
import { parseCloudConfig } from '../src/cloud/config';

const MAX_BODY = 4 * 1024 * 1024;
const MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface AnalyzeEnv { apiKey?: string; model?: string; fetchImpl?: typeof fetch }

async function askModel(body: any, env: AnalyzeEnv, prompt: string): Promise<{ status: number; json?: unknown; text?: string }> {
  if (!env.apiKey) return { status: 503, json: { error: 'not_configured' } };
  const image = typeof body?.image === 'string' ? body.image : '';
  const mediaType = MEDIA.has(body?.mediaType) ? body.mediaType : 'image/jpeg';
  if (!image || !/^[A-Za-z0-9+/=]+$/.test(image)) return { status: 400, json: { error: 'bad_image' } };
  const f = env.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await f('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.model ?? 'claude-haiku-5-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
          { type: 'text', text: prompt },
        ] }],
      }),
    });
  } catch {
    return { status: 502, json: { error: 'upstream' } };
  }
  if (!res.ok) return { status: 502, json: { error: 'upstream' } };
  const data: any = await res.json().catch(() => null);
  const text = (data?.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  return { status: 200, text };
}

export async function analyze(body: any, env: AnalyzeEnv): Promise<{ status: number; json: unknown }> {
  const r = await askModel(body, env, RECOGNITION_PROMPT);
  if (r.text === undefined) return { status: r.status, json: r.json };
  const n = normalizeRecognition(extractJson(r.text));
  if (!n.ok) return { status: n.error === 'not_garment' ? 422 : 502, json: { error: n.error } };
  return { status: 200, json: { suggestion: n.suggestion } };
}

/** Receipt photo -> item lines only. The image is not stored or logged. */
export async function analyzeReceipt(body: any, env: AnalyzeEnv): Promise<{ status: number; json: unknown }> {
  const r = await askModel(body, env, RECEIPT_PROMPT);
  if (r.text === undefined) return { status: r.status, json: r.json };
  const n = normalizeReceipt(extractJson(r.text));
  if (!n) return { status: 502, json: { error: 'invalid' } };
  return { status: 200, json: n };
}

export async function product(body: any, env: AnalyzeEnv & { transport?: any; lookup?: any }): Promise<{ status: number; json: unknown }> {
  const url = typeof body?.url === 'string' ? body.url.trim().slice(0, 600) : '';
  if (!url) return { status: 400, json: { error: 'bad_url' } };
  const r = await fetchProduct(url, { transport: env.transport, lookup: env.lookup });
  return { status: r.status === 'invalid_url' ? 400 : 200, json: r };
}

export interface ServerEnv extends AnalyzeEnv {
  allowedOrigin?: string; token?: string; perHour?: number;
  /** authenticated photo analysis (Supabase session + quotas + Gemini). This is the ONLY route meant for real users. */
  analysis?: AnalysisDeps;
  /** the old unauthenticated /analyze, /receipt, /product routes. OFF unless explicitly enabled (local experiments only). */
  legacyUnauthenticated?: boolean;
  /** how many reverse proxies sit in front (their X-Forwarded-For entries are trusted). 0 = use the socket address only. */
  trustProxyHops?: number;
  /** simultaneous authenticated analysis requests the process accepts */
  maxConcurrent?: number;
}

/** The client address used for rate limiting. X-Forwarded-For is only believed for the configured number of trusted hops (counted from the right). */
export function clientIp(xff: string | undefined, socketAddr: string | undefined, hops = 0): string {
  if (hops > 0 && xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    const pick = parts[parts.length - hops];
    if (pick) return pick.slice(0, 64);
  }
  return socketAddr ?? 'unknown';
}

export function createServer(env: ServerEnv) {
  const hits = new Map<string, number[]>();
  let active = 0;
  const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const origin = env.allowedOrigin ?? '*';
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' });
      res.end(JSON.stringify(json));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, recognition: !!env.analysis?.provider || (!!env.legacyUnauthenticated && !!env.apiKey), authenticated: !!env.analysis });
    const legacy = env.legacyUnauthenticated ? (req.url === '/analyze' ? analyze : req.url === '/receipt' ? analyzeReceipt : req.url === '/product' ? product : null) : null;
    const isV1 = req.url === '/v1/analyze-photo' && !!env.analysis;
    if (req.method !== 'POST' || (!legacy && !isV1)) return send(404, { error: 'not_found' });
    if (legacy && env.token && req.headers.authorization !== `Bearer ${env.token}`) return send(401, { error: 'unauthorized' });
    const ip = clientIp(String(req.headers['x-forwarded-for'] ?? '') || undefined, req.socket.remoteAddress, env.trustProxyHops);
    const now = Date.now();
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => now - x < 3600_000)) hits.delete(k); // bounded memory
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= (env.perHour ?? (isV1 ? 120 : 30))) return send(429, { error: 'rate_limited' });
    hits.set(ip, [...recent, now]);
    let verified: Awaited<ReturnType<typeof verifySession>> | undefined;
    if (isV1) {
      // Authenticate BEFORE buffering any body: an anonymous caller cannot make the server hold megabytes.
      if (active >= (env.maxConcurrent ?? 20)) { res.setHeader('connection', 'close'); return send(503, { error: 'overloaded' }); }
      active++; res.once('close', () => { active--; }); // counted from here (auth call + body buffering + analysis) until the response/socket closes, on every path
      verified = await verifySession(req.headers.authorization, env.analysis!.supabase);
      if (!verified.ok) { res.setHeader('connection', 'close'); return send(verified.status, { error: verified.error }); }
    }
    const limit = isV1 ? MAX_BODY_BYTES : MAX_BODY;
    if (Number(req.headers['content-length'] ?? 0) > limit) { res.setHeader('connection', 'close'); return send(413, { error: 'too_large' }); } // rejected before reading
    let size = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > limit) { res.setHeader('connection', 'close'); return send(413, { error: 'too_large' }); }
        chunks.push(c as Buffer);
      }
    } catch { return; } // client aborted or timed out mid-body: nothing to answer, and it must never take the process down
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'bad_json' }); }
    let out: { status: number; json: unknown };
    if (isV1) out = await analyzePhoto(req.headers.authorization, body, env.analysis!, verified && verified.ok ? verified.user : undefined);
    else out = await legacy!(body, env as any);
    send(out.status, out.json);
  };
  const srv = http.createServer((req, res) => {
    req.on('error', () => {});
    handle(req, res).catch(() => { // last line of defence: an unexpected error answers 500 instead of becoming an unhandled rejection
      try { if (!res.headersSent) { res.statusCode = 500; res.end('{"error":"server"}'); } else res.destroy(); } catch { /* socket already gone */ }
    });
  });
  srv.headersTimeout = 10_000; srv.requestTimeout = 30_000; // slow-body callers are cut off
  return srv;
}

if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8787);
  const cfg = parseCloudConfig(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY); // refuses service-role / secret keys
  const supabase = cfg.ok ? { url: cfg.url, anonKey: cfg.anonKey } : undefined;
  if (!supabase) console.warn('SUPABASE_URL / SUPABASE_ANON_KEY (public key) missing or invalid: authenticated analysis is DISABLED');
  const legacyUnauthenticated = process.env.ALLOW_LEGACY_UNAUTHENTICATED === '1' && process.env.NODE_ENV !== 'production';
  createServer({
    allowedOrigin: process.env.ALLOWED_ORIGIN,
    analysis: supabase ? {
      supabase,
      quota: supabaseQuota(supabase),
      photos: supabasePhotos(supabase),
      provider: process.env.GEMINI_API_KEY ? geminiProvider({ apiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL }) : undefined,
      inFlight: new Set<string>(),
    } : undefined,
    legacyUnauthenticated,
    trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0) || 0,
    apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.RECOGNITION_MODEL, token: process.env.RECOGNITION_TOKEN,
  }).listen(port, legacyUnauthenticated ? '127.0.0.1' : undefined, () => console.log(`server on :${port}${legacyUnauthenticated ? ' (LEGACY unauthenticated routes ON, loopback only)' : ''} (authenticated analysis ${supabase ? 'on' : 'OFF'}, provider ${process.env.GEMINI_API_KEY ? 'configured' : 'NOT configured'})`));
}
