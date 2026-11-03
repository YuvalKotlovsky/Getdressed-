/**
 * Photo recognition proxy. Keeps the Anthropic API key on the server.
 *   ANTHROPIC_API_KEY=... npm run server        (PORT, ALLOWED_ORIGIN, RECOGNITION_MODEL optional)
 * The app sends ONE resized garment photo; nothing is stored or logged here.
 */
import http from 'node:http';
import { RECOGNITION_PROMPT, extractJson, normalizeRecognition } from '../src/tagging/schema';
import { RECEIPT_PROMPT, normalizeReceipt } from '../src/import/receiptSchema';
import { fetchProduct } from './product';

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

export function createServer(env: AnalyzeEnv & { allowedOrigin?: string; token?: string; perHour?: number }) {
  const hits = new Map<string, number[]>();
  return http.createServer(async (req, res) => {
    const origin = env.allowedOrigin ?? '*';
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'POST,OPTIONS' });
      res.end(JSON.stringify(json));
    };
    if (req.method === 'OPTIONS') return send(204, {});
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
    const route = req.url === '/analyze' ? analyze : req.url === '/receipt' ? analyzeReceipt : req.url === '/product' ? product : null;
    if (req.method !== 'POST' || !route) return send(404, { error: 'not_found' });
    if (env.token && req.headers.authorization !== `Bearer ${env.token}`) return send(401, { error: 'unauthorized' });
    const ip = String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? '');
    const now = Date.now();
    const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= (env.perHour ?? 30)) return send(429, { error: 'rate_limited' });
    hits.set(ip, [...recent, now]);
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) return send(413, { error: 'too_large' });
      chunks.push(c as Buffer);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'bad_json' }); }
    const out = await route(body, env as any);
    send(out.status, out.json);
  });
}

if (process.argv[1] && /server[\\/]index\.ts$/.test(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8787);
  createServer({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.RECOGNITION_MODEL,
    allowedOrigin: process.env.ALLOWED_ORIGIN,
    token: process.env.RECOGNITION_TOKEN,
  }).listen(port, () => console.log(`recognition server on :${port}${process.env.ANTHROPIC_API_KEY ? '' : ' (ANTHROPIC_API_KEY missing)'}`));
}
