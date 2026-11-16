import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { analyzePhoto, MAX_IMAGE_BYTES, type AnalysisDeps, type PhotoStore } from '../server/photoAnalysis';
import { estimateCostUSD, geminiProvider, type Provider } from '../server/gemini';
import { createServer } from '../server/index';
import type { QuotaResult, QuotaStore } from '../server/quota';
type QuotaLimits = { perDay: number; perMonth: number; globalPerDay: number }; // fixed inside the database in production; modelled here by the fake
import { createRecognitionTagger, RecognitionError } from '../src/tagging/recognition';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ITEM = '11111111-1111-4111-8111-111111111111';
const PHOTO = '22222222-2222-4222-8222-222222222222';
const tokenOf = (u: string) => `tok_${u}_xxxxxxxxxxxxxxxx`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const b64 = (b: Buffer) => b.toString('base64');

const GARMENT = JSON.stringify({ garment: true, category: 'dress', subtype: 'שמלה', color: 'black', occasions: ['evening'], dressiness: 2, weather: ['mild'], confidence: { category: 0.9, subtype: 0.9, color: 0.2, occasions: 0.4, dressiness: 0.9, weather: 0.9 } });

/** Fake Supabase Auth: tokens `tok_<uuid>_...` are valid, `expired` is not; B2 is unverified. */
function fakeAuth(opts: { down?: boolean; unverified?: string[] } = {}) {
  const calls = { n: 0 };
  const fetchImpl = (async (url: string, init: any) => {
    calls.n++;
    assert.ok(String(url).endsWith('/auth/v1/user'));
    if (opts.down) throw new Error('down');
    const m = /^Bearer tok_([0-9a-f-]{36})_/.exec(init.headers.authorization);
    if (!m) return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ id: m[1], email_confirmed_at: opts.unverified?.includes(m[1]) ? null : '2026-01-01T00:00:00Z' }), { status: 200 });
  }) as any;
  return { fetchImpl, calls };
}

/** In-memory quota with the same decision order as consume_ai_quota (day, month, global). */
function memQuota(l: QuotaLimits): QuotaStore & { used: Map<string, number>; calls: number; broken?: boolean } {
  const used = new Map<string, number>();
  const q: any = { used, calls: 0, broken: false,
    async consume(user: { userId: string }, _k: string): Promise<QuotaResult> {
      q.calls++;
      if (q.broken) return { allowed: 'error' };
      const mine = used.get(user.userId) ?? 0;
      const total = [...used.values()].reduce((a, b) => a + b, 0);
      if (mine >= l.perDay) return { allowed: false, scope: 'day', used: mine, limit: l.perDay };
      if (total >= l.globalPerDay) return { allowed: false, scope: 'global', used: total, limit: l.globalPerDay };
      used.set(user.userId, mine + 1);
      return { allowed: true, used: mine + 1, limit: l.perDay };
    } };
  return q;
}

function setup(over: Partial<AnalysisDeps> & { reply?: string; unverified?: string[]; limits?: QuotaLimits; authDown?: boolean; stored?: Record<string, Buffer> } = {}) {
  const auth = fakeAuth({ unverified: over.unverified, down: over.authDown });
  const quota = memQuota(over.limits ?? { perDay: 2, perMonth: 10, globalPerDay: 100 });
  const provider = { calls: 0, last: undefined as any, async analyze(img: any) { provider.calls++; provider.last = img; return over.reply ?? GARMENT; } };
  const downloads: string[] = [];
  const photos: PhotoStore = {
    async download(user, path) {
      downloads.push(`${user.userId}:${path}`);
      const hit = over.stored?.[path];
      // storage RLS: only the owner's folder is readable with the owner's token
      return hit && path.startsWith(`${user.userId}/`) ? { bytes: hit } : 'not_found';
    },
  };
  const deps: AnalysisDeps = { supabase: { url: 'https://x.supabase.co', anonKey: 'sb_publishable_x', fetchImpl: auth.fetchImpl }, quota, photos,
    provider: over.provider === undefined && 'provider' in over ? undefined : (over.provider ?? (provider as Provider)), inFlight: new Set(), maxImageBytes: over.maxImageBytes };
  return { deps, auth, quota, provider, downloads };
}
const hdr = (u: string) => `Bearer ${tokenOf(u)}`;

test('happy path: suggestion comes back for review, uncertain fields are flagged, quota counted once', async () => {
  const s = setup();
  const r = await analyzePhoto(hdr(A), { image: b64(JPEG) }, s.deps);
  assert.equal(r.status, 200);
  const j: any = r.json;
  assert.equal(j.suggestion.category, 'dress');
  assert.deepEqual(j.suggestion.uncertain.sort(), ['color', 'occasions']); // low-confidence fields are flagged "לבדיקה"
  assert.deepEqual(j.quota, { used: 1, limit: 2 });
  assert.equal(s.provider.calls, 1);
  assert.equal(s.provider.last.mediaType, 'image/jpeg');
  assert.equal(s.quota.used.get(A), 1);
});

test('invalid sessions never reach quota, storage or the provider', async () => {
  for (const [name, header, over] of [
    ['no header', undefined, {}], ['not bearer', 'Basic abc', {}], ['garbage token', 'Bearer x', {}], ['rejected by Auth', 'Bearer expired_token_expired_token', {}],
    ['unverified email', hdr(B), { unverified: [B] }],
  ] as const) {
    const s = setup(over as any);
    const r = await analyzePhoto(header as any, { image: b64(JPEG) }, s.deps);
    assert.ok([401, 403].includes(r.status), `${name}: ${r.status}`);
    assert.equal(s.provider.calls + s.quota.calls + s.downloads.length, 0, name);
  }
  const down = setup({ authDown: true });
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, down.deps)).status, 503); // fails closed
  assert.equal(down.provider.calls, 0);
});

test('the user id comes from the verified session, not from the request body', async () => {
  const s = setup();
  await analyzePhoto(hdr(A), { image: b64(JPEG), userId: B, user_id: B }, s.deps);
  assert.equal(s.quota.used.get(A), 1);
  assert.equal(s.quota.used.has(B), false);
});

test('stored photos: own photo works; another account\'s photo is refused before storage, quota or provider', async () => {
  const mine = `${A}/${ITEM}/${PHOTO}.jpg`, theirs = `${B}/${ITEM}/${PHOTO}.jpg`;
  const s = setup({ stored: { [mine]: JPEG, [theirs]: JPEG } });
  const ok = await analyzePhoto(hdr(A), { photoPath: mine }, s.deps);
  assert.equal(ok.status, 200);
  assert.deepEqual(s.downloads, [`${A}:${mine}`]);
  const callsBefore = s.provider.calls, quotaBefore = s.quota.calls;
  const x = await analyzePhoto(hdr(A), { photoPath: theirs }, s.deps);
  assert.equal(x.status, 403);
  assert.equal(s.downloads.length, 1); // never even fetched
  assert.equal(s.provider.calls, callsBefore); assert.equal(s.quota.calls, quotaBefore);
  // path tricks and malformed paths
  for (const p of [`${A}/../${B}/${ITEM}/${PHOTO}.jpg`, `${A}/${ITEM}/${PHOTO}.png`, `/${A}/${ITEM}/${PHOTO}.jpg`, `${A.toUpperCase()}/x/y.jpg`, 'closet-photos/' + mine])
    assert.equal((await analyzePhoto(hdr(A), { photoPath: p }, s.deps)).status, 400, p);
  // storage RLS is a second layer: a missing/hidden object is 404 and costs nothing
  const miss = await analyzePhoto(hdr(A), { photoPath: `${A}/${ITEM}/${ITEM}.jpg` }, s.deps);
  assert.equal(miss.status, 404); assert.equal(s.provider.calls, 1);
});

test('limits: oversized, wrong type, bad base64, both/neither inputs - none consume quota', async () => {
  const s = setup({ maxImageBytes: 1000 });
  const big = Buffer.concat([JPEG, Buffer.alloc(2000)]);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(big) }, s.deps)).status, 413);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(Buffer.from('<?php evil ?>................')) }, s.deps)).status, 415);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(Buffer.from('GIF89a' + 'x'.repeat(40))), mediaType: 'image/jpeg' }, s.deps)).status, 415); // declared type is ignored
  assert.equal((await analyzePhoto(hdr(A), { image: '<not base64>' }, s.deps)).status, 400);
  assert.equal((await analyzePhoto(hdr(A), {}, s.deps)).status, 400);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG), photoPath: `${A}/${ITEM}/${PHOTO}.jpg` }, s.deps)).status, 400);
  assert.equal(s.quota.calls, 0); assert.equal(s.provider.calls, 0);
  assert.ok(MAX_IMAGE_BYTES <= 2_000_000);
});

test('quota: persistent per user, exhausted -> 429 before any provider call, other users unaffected, fails closed', async () => {
  const s = setup();
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, s.deps)).status, 200);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, s.deps)).status, 200);
  const third: any = await analyzePhoto(hdr(A), { image: b64(JPEG) }, s.deps);
  assert.equal(third.status, 429); assert.equal(third.json.error, 'quota_exceeded'); assert.equal(third.json.scope, 'day');
  assert.equal(s.provider.calls, 2);
  assert.equal((await analyzePhoto(hdr(B), { image: b64(JPEG) }, s.deps)).status, 200); // B has its own allowance
  s.quota.broken = true; // quota store unreachable
  const f = await analyzePhoto(hdr(B), { image: b64(JPEG) }, s.deps);
  assert.equal(f.status, 503); assert.equal(s.provider.calls, 3);
  const g = setup({ limits: { perDay: 5, perMonth: 10, globalPerDay: 1 } });
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, g.deps)).status, 200);
  const glob: any = await analyzePhoto(hdr(B), { image: b64(JPEG) }, g.deps);
  assert.equal(glob.status, 429); assert.equal(glob.json.scope, 'global'); // circuit breaker
});

test('provider failures stay counted (no free retries), not-a-garment is 422, unconfigured is 503, one request at a time per user', async () => {
  const bad = setup({ provider: { async analyze() { throw new Error('boom'); } } });
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, bad.deps)).status, 502);
  assert.equal(bad.quota.used.get(A), 1);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, setup({ reply: '{"garment":false}' }).deps)).status, 422);
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, setup({ reply: 'not json at all' }).deps)).status, 502);
  const none = setup({ provider: undefined as any });
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, none.deps)).status, 503);
  assert.equal(none.quota.calls, 0);
  let release!: () => void;
  const slow = setup({ provider: { analyze: () => new Promise<string>((res) => { release = () => res(GARMENT); }) } });
  const first = analyzePhoto(hdr(A), { image: b64(JPEG) }, slow.deps);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, slow.deps)).status, 429); // busy
  release(); assert.equal((await first).status, 200);
});

test('Gemini adapter (Interactions API): image + prompt + JSON schema, key in a header, nothing stored, usage and cost parsed, failures typed', async () => {
  let seen: any;
  const reply = (over: any = {}) => (async (url: string, init: any) => { seen = { url, init }; return new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'user_input', content: [] }, { type: 'model_output', content: [{ type: 'text', text: GARMENT }] }], usage: { total_input_tokens: 2000, total_output_tokens: 250, total_thought_tokens: 0, total_tokens: 2250 }, ...over }), { status: 200 }); }) as any;
  const r: any = await geminiProvider({ apiKey: 'AIza-secret', fetchImpl: reply() }).analyze({ bytes: JPEG, mediaType: 'image/jpeg' }, 'PROMPT');
  assert.equal(r.text, GARMENT);
  assert.deepEqual(r.usage, { input: 2000, output: 250, thoughts: 0, total: 2250 });
  assert.ok(Math.abs(estimateCostUSD(r.usage)! - (2000 * 0.30 + 250 * 2.50) / 1e6) < 1e-12);
  assert.ok(seen.url.endsWith('/v1beta/interactions')); assert.ok(!seen.url.includes('AIza-secret'));
  assert.equal(seen.init.headers['x-goog-api-key'], 'AIza-secret');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'gemini-3.5-flash-lite');
  assert.deepEqual(body.input[1], { type: 'image', data: JPEG.toString('base64'), mime_type: 'image/jpeg' });
  assert.equal(body.input[0].text, 'PROMPT');
  assert.equal(body.response_format.mime_type, 'application/json'); assert.equal(body.response_format.schema.properties.category.enum.includes('shoes'), true);
  assert.deepEqual([body.generation_config.max_output_tokens, body.generation_config.thinking_level, body.store], [1024, 'minimal', false]);
  const bad = (over: any) => geminiProvider({ apiKey: 'k', fetchImpl: reply(over) }).analyze({ bytes: JPEG, mediaType: 'image/jpeg' }, 'p');
  await assert.rejects(bad({ status: 'incomplete' })); // output cap hit while thinking
  await assert.rejects(bad({ steps: [] }));
  await assert.rejects(geminiProvider({ apiKey: 'k', fetchImpl: (async () => new Response('x', { status: 500 })) as any }).analyze({ bytes: JPEG, mediaType: 'image/jpeg' }, 'p'));
  // usage is reported through the server hook without any user id or photo
  const s = setup({ provider: { async analyze() { return { text: GARMENT, usage: { input: 10, output: 5 } }; } } });
  let rec: any; s.deps.onUsage = (x) => { rec = x; };
  assert.equal((await analyzePhoto(hdr(A), { image: b64(JPEG) }, s.deps)).status, 200);
  assert.deepEqual(Object.keys(rec).sort(), ['ms', 'ok', 'usage']); assert.equal(rec.usage.input, 10);
});

function rawPost(base: string, path: string, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve) => {
    const u = new URL(base);
    const req = require('node:http').request({ host: u.hostname, port: u.port, path, method: 'POST', headers }, (res: any) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(0)); req.end(body.slice(0, 2));
  });
}

test('HTTP: full flow through the server; legacy unauthenticated routes are off; oversize rejected before reading', async () => {
  const s = setup();
  const srv = createServer({ analysis: s.deps }); // legacyUnauthenticated defaults to off
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const post = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
    assert.equal((await post('/v1/analyze-photo', { image: b64(JPEG) })).status, 401);
    const ok = await post('/v1/analyze-photo', { image: b64(JPEG) }, { authorization: hdr(A) });
    assert.equal(ok.status, 200); assert.equal(((await ok.json()) as any).suggestion.category, 'dress');
    for (const legacy of ['/analyze', '/receipt', '/product']) assert.equal((await post(legacy, { image: b64(JPEG) })).status, 404, legacy);
    // an anonymous caller is refused BEFORE the body is read (the 3 MB body is never buffered); a lying Content-Length is refused outright
    const anonHuge = await post('/v1/analyze-photo', { image: 'A'.repeat(3_000_000) }).then((r) => r.status, () => 'reset');
    assert.ok(anonHuge === 401 || anonHuge === 'reset', `got ${anonHuge}`);
    const lied = await rawPost(base, '/v1/analyze-photo', { authorization: hdr(A), 'content-length': '9999999' }, '{}');
    assert.equal(lied, 413);
    const huge = await post('/v1/analyze-photo', { image: 'A'.repeat(3_000_000) }, { authorization: hdr(A) }).then((r) => r.status, () => 'reset');
    assert.ok(huge === 413 || huge === 'reset', `got ${huge}`);
    assert.equal(s.provider.calls, 1);
    assert.equal(s.auth.calls.n >= 2, true); // auth is checked per request, before bodies
    const h: any = await (await fetch(base + '/health')).json();
    assert.deepEqual([h.ok, h.recognition, h.authenticated], [true, true, true]);
  } finally { srv.close(); }
});

test('client: sends the session token, maps every failure to a typed error so manual entry stays available', async () => {
  const photo = { base64: 'QUJD', mediaType: 'image/jpeg' as const };
  let seen: any;
  const ok = (async (u: string, init: any) => { seen = { u, init }; return { ok: true, status: 200, json: async () => ({ suggestion: { category: 'dress', subtype: 'שמלה', uncertain: ['color'] } }) }; }) as any;
  const s = await createRecognitionTagger('https://x', ok, 1000, async () => 'jwt-abc').suggest(photo);
  assert.deepEqual([s.category, s.uncertain], ['dress', ['color']]); // shown for review, flagged
  assert.equal(seen.init.headers.authorization, 'Bearer jwt-abc'); assert.ok(seen.u.endsWith('/v1/analyze-photo'));
  const kind = async (impl: any, tok: (() => Promise<string | null>) | undefined = async () => 't') => {
    try { await createRecognitionTagger('https://x', impl, 1000, tok).suggest(photo); return 'ok'; } catch (e) { return (e as RecognitionError).kind; }
  };
  const fail = (status: number, error: string) => (async () => ({ ok: false, status, json: async () => ({ error }) })) as any;
  assert.equal(await kind(ok, async () => null), 'unauthorized'); // signed out: nothing is sent
  assert.equal(await kind(fail(401, 'unauthorized')), 'unauthorized');
  assert.equal(await kind(fail(429, 'quota_exceeded')), 'quota');
  assert.equal(await kind((async () => ({ ok: false, status: 429, json: async () => ({ error: 'quota_exceeded', scope: 'global' }) })) as any), 'quota_global');
  assert.equal(await kind(fail(403, 'email_not_verified')), 'unverified');
  assert.equal(await createRecognitionTagger('http://evil.example', ok, 1000, async () => 't').suggest(photo).then(() => 'sent', (e) => e.kind), 'not_configured'); // token never goes over plain http
  assert.equal(await createRecognitionTagger('http://localhost:8787', ok, 1000, async () => 't').suggest(photo).then(() => 'sent', (e) => e.kind), 'sent');
  assert.equal(await kind(fail(429, 'busy')), 'busy');
  assert.equal(await kind(fail(413, 'too_large')), 'too_large');
  assert.equal(await kind(fail(502, 'upstream')), 'server');
  assert.equal(await kind((async () => { throw new Error('offline'); }) as any), 'network');
});

test('rate-limit key: X-Forwarded-For is ignored unless proxy hops are configured (no header-rotation bypass)', async () => {
  const { clientIp } = await import('../server/index');
  assert.equal(clientIp('1.2.3.4', '9.9.9.9'), '9.9.9.9');
  assert.equal(clientIp('1.2.3.4, 5.6.7.8', '9.9.9.9', 0), '9.9.9.9');
  assert.equal(clientIp('6.6.6.6, 1.2.3.4', '9.9.9.9', 1), '1.2.3.4'); // the rightmost entry is the one OUR proxy appended
  assert.equal(clientIp('', '9.9.9.9', 1), '9.9.9.9');
});

test('uppercase owner folder: the app check is case-insensitive, but storage (RLS compares the exact text) is the final judge and costs nothing', async () => {
  const s = setup({ stored: { [`${A}/${ITEM}/${PHOTO}.jpg`]: JPEG } });
  const r = await analyzePhoto(hdr(A), { photoPath: `${A.toUpperCase()}/${ITEM}/${PHOTO}.jpg` }, s.deps);
  assert.equal(r.status, 404); // not 403 (it is the same user) and not 200 (storage does not serve it)
  assert.equal(s.quota.calls + s.provider.calls, 0);
});

/** raw socket helper: send `head` (+ optional partial body), then act */
function rawSocket(base: string, lines: string[], opts: { destroyAfterMs?: number; readUntil?: RegExp } = {}): Promise<string> {
  return new Promise((resolve) => {
    const u = new URL(base);
    const sock = require('node:net').connect(Number(u.port), u.hostname, () => sock.write(lines.join('\r\n') + '\r\n\r\n'));
    let buf = '';
    sock.on('data', (d: Buffer) => { buf += d.toString(); if (opts.readUntil?.test(buf)) { sock.destroy(); resolve(buf); } });
    sock.on('error', () => {}); sock.on('close', () => resolve(buf));
    if (opts.destroyAfterMs) setTimeout(() => sock.destroy(), opts.destroyAfterMs);
  });
}

test('HTTP: a client that aborts mid-body cannot crash the server, and the concurrency slot is released', async () => {
  const s = setup();
  const srv = createServer({ analysis: s.deps, maxConcurrent: 2 });
  const unhandled: unknown[] = []; const onUnhandled = (e: unknown) => unhandled.push(e); process.on('unhandledRejection', onUnhandled);
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    for (let i = 0; i < 5; i++) { // more aborts than the cap: slots must be freed every time
      await rawSocket(base, ['POST /v1/analyze-photo HTTP/1.1', 'host: x', `authorization: ${hdr(A)}`, 'content-type: application/json', 'content-length: 100000', '', '{"image":"AAAA'], { destroyAfterMs: 60 });
    }
    await new Promise((r) => setTimeout(r, 100));
    assert.equal((await fetch(base + '/health')).status, 200); // still alive
    const ok = await fetch(base + '/v1/analyze-photo', { method: 'POST', headers: { 'content-type': 'application/json', authorization: hdr(A) }, body: JSON.stringify({ image: b64(JPEG) }) });
    assert.equal(ok.status, 200); // slots were released (cap is 2, five aborts happened)
    assert.deepEqual(unhandled, []);
  } finally { process.off('unhandledRejection', onUnhandled); srv.close(); }
});

test('HTTP: an anonymous caller is answered 401 BEFORE it has sent its body; the overload cap answers 503', async () => {
  const s = setup();
  const srv = createServer({ analysis: s.deps, maxConcurrent: 1 });
  await new Promise<void>((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    // headers announce a 2 MB body that is never sent; a server that read the body first would wait, this one answers at once
    const anon = await rawSocket(base, ['POST /v1/analyze-photo HTTP/1.1', 'host: x', 'content-type: application/json', 'content-length: 2000000'], { readUntil: /\r\n\r\n/ });
    assert.match(anon, /^HTTP\/1\.1 401/);
    // one authenticated request holds the only slot (its body is never completed) -> the next one is 503
    const hold = rawSocket(base, ['POST /v1/analyze-photo HTTP/1.1', 'host: x', `authorization: ${hdr(A)}`, 'content-type: application/json', 'content-length: 2000000'], { destroyAfterMs: 600 });
    await new Promise((r) => setTimeout(r, 200));
    const second = await rawSocket(base, ['POST /v1/analyze-photo HTTP/1.1', 'host: x', `authorization: ${hdr(B)}`, 'content-type: application/json', 'content-length: 10'], { readUntil: /\r\n\r\n/ });
    assert.match(second, /^HTTP\/1\.1 503/);
    await hold;
    assert.equal(s.provider.calls, 0);
  } finally { srv.close(); }
});
