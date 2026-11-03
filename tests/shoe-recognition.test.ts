import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { RECOGNITION_PROMPT, canonicalSubtype, normalizeRecognition, sanitizeSuggestion } from '../src/tagging/schema';
import { checkRecognitionServer } from '../src/tagging/recognition';
import { analyze, createServer } from '../server/index';

// What a correct model answer looks like for the dark-blue Birkenstock Boston clog photo (hand-written, NOT a real model response).
const CLOG = {
  garment: true, multiple: true, category: 'shoes', subtype: 'כפכף סגור / קלוג', color: 'navy', occasions: ['casual'], dressiness: 1, weather: ['mild', 'cold'],
  brand: { brand: 'Birkenstock', model: 'Boston', source: 'caption' },
  confidence: { category: 0.97, subtype: 0.9, color: 0.9, occasions: 0.8, dressiness: 0.8, weather: 0.7, brand: 0.85 },
};

test('clog reply maps to נעליים → כפכף סגור / קלוג → כחול כהה, with a brand to confirm', () => {
  const n = normalizeRecognition(CLOG);
  assert.ok(n.ok);
  if (!n.ok) return;
  const s = n.suggestion;
  assert.deepEqual([s.category, s.part, s.subtype, s.color], ['shoes', 'shoes', 'כפכף סגור / קלוג', 'navy']);
  assert.deepEqual(s.brand, { brand: 'Birkenstock', model: 'Boston', source: 'caption' });
  assert.equal(s.multiple, true);
  assert.deepEqual(s.uncertain, []);
});

test('generalizes: a different shoe without a caption gets no brand, and model wording is canonicalised', () => {
  const sneaker = normalizeRecognition({ garment: true, category: 'shoes', subtype: 'Sneakers', color: 'white', occasions: ['casual', 'workout'], dressiness: 1, weather: ['hot', 'mild'], brand: null, confidence: { category: 0.95, subtype: 0.9, color: 0.9, occasions: 0.8, dressiness: 0.8, weather: 0.7 } });
  assert.ok(sneaker.ok);
  if (sneaker.ok) { assert.equal(sneaker.suggestion.subtype, 'סניקרס'); assert.equal(sneaker.suggestion.brand, undefined); }
  assert.equal(canonicalSubtype('Leather clog'), 'כפכף סגור / קלוג');
  assert.equal(canonicalSubtype('בלרינות'), 'בלרינות');
  const lowBrand = normalizeRecognition({ ...CLOG, brand: { brand: 'Birkenstock', model: 'Boston', source: 'shape' }, confidence: { ...CLOG.confidence, brand: 0.2 } });
  assert.ok(lowBrand.ok && lowBrand.suggestion.brand === undefined, 'a very unsure brand guess is not shown');
});

test('unrecognized fields stay empty and are flagged (never defaulted to חולצות / לבן)', () => {
  const n = normalizeRecognition({ garment: true, category: 'shoes', subtype: '', color: 'chartreuse', occasions: [], confidence: {} });
  assert.ok(n.ok);
  if (!n.ok) return;
  assert.equal(n.suggestion.color, undefined);
  assert.equal(n.suggestion.occasions, undefined);
  assert.equal(n.suggestion.dressiness, undefined);
  for (const f of ['subtype', 'color', 'occasions', 'dressiness', 'weather'] as const) assert.ok(n.suggestion.uncertain!.includes(f), f);
  const s = sanitizeSuggestion({ category: 'shoes', brand: { brand: 'Birkenstock', model: 'Boston', source: 'caption' }, uncertain: ['color', 'bogus'] });
  assert.deepEqual(s?.uncertain, ['color']);
  assert.equal(s?.brand?.model, 'Boston');
});

test('prompt tells the model to tag the foreground item, read captions for brand, and use the clog vocabulary', () => {
  assert.match(RECOGNITION_PROMPT, /MAIN item/);
  assert.match(RECOGNITION_PROMPT, /Ignore hands, backgrounds, shelves/);
  assert.match(RECOGNITION_PROMPT, /כפכף סגור \/ קלוג/);
  assert.match(RECOGNITION_PROMPT, /בירקנשטוק בוסטון = Birkenstock Boston/);
  assert.match(RECOGNITION_PROMPT, /Never guess a brand from colour alone/);
});

test('server sends the image with that prompt and returns the normalized suggestion', async () => {
  let sent: any;
  const f = (async (_u: string, init: any) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(CLOG) }] }) }; }) as any;
  const out: any = await analyze({ image: 'QUJD', mediaType: 'image/png' }, { apiKey: 'k', fetchImpl: f });
  assert.equal(out.status, 200);
  assert.equal(out.json.suggestion.brand.model, 'Boston');
  assert.equal(sent.messages[0].content[0].source.media_type, 'image/png');
  assert.match(sent.messages[0].content[1].text, /MAIN item/);
});

test('health check tells the app why recognition is unavailable', async () => {
  const res = (ok: boolean, body: any) => (async () => ({ ok, json: async () => body })) as any;
  assert.equal(await checkRecognitionServer(undefined, res(true, {})), 'unconfigured');
  assert.equal(await checkRecognitionServer('http://x', res(true, { ok: true, recognition: true })), 'ready');
  assert.equal(await checkRecognitionServer('http://x', res(true, { ok: true, recognition: false })), 'nokey');
  assert.equal(await checkRecognitionServer('http://x', res(false, {})), 'down');
  assert.equal(await checkRecognitionServer('http://x', (async () => { throw new Error('offline'); }) as any), 'down');
});

test('GET /health reports whether the server has an API key', async () => {
  for (const [key, expected] of [['sk', true], [undefined, false]] as const) {
    const srv = createServer({ apiKey: key });
    srv.listen(0);
    await once(srv, 'listening');
    const port = (srv.address() as AddressInfo).port;
    const j: any = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.deepEqual([j.ok, j.recognition], [true, expected]);
    srv.close();
  }
});
