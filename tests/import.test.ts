import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { parseProductHtml, zaraProductUrl, zaraRefFromUrl } from '../src/import/parseProduct';
import { inferFromName, colorKeyFromText } from '../src/import/infer';
import { parseReceiptText, receiptFingerprint, classifyMatch, candidateUrl } from '../src/import/receipt';
import { normalizeReceipt } from '../src/import/receiptSchema';
import { assertPublicUrl, isPublicIp, safeFetch, SafeFetchError, type Transport } from '../server/safeFetch';
import { fetchProduct } from '../server/product';
import { analyzeReceipt, product } from '../server/index';

// FIXTURE page (hand-written in the shape of common JSON-LD product pages). NOT a captured Zara page.
const PAGE = 'https://www.zara.com/il/he/%D7%A9%D7%9E%D7%9C%D7%94-p02183151.html';
const LD = `<html><head><title>שמלה | ZARA</title><script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org', '@type': 'Product', name: 'שמלה פופלין שחורה', image: ['/photos/2183/151/1.jpg'], color: 'שחור', sku: '2183/151', brand: { '@type': 'Brand', name: 'ZARA' },
})}</script></head><body></body></html>`;

const pub = async () => ['93.184.216.34'];
const resp = (status: number, body: string | Buffer = '', headers: Record<string, string> = {}) => ({ status, headers, body: Buffer.from(body) });
const fakeTransport = (map: Record<string, ReturnType<typeof resp>>, seen: string[] = []): Transport => async (url) => {
  seen.push(url.toString());
  const r = map[url.toString()];
  if (!r) return resp(404);
  return r;
};

test('product parser: JSON-LD name/image/color/reference (fixture)', () => {
  const p = parseProductHtml(LD, PAGE);
  assert.equal(p.name, 'שמלה פופלין שחורה');
  assert.equal(p.imageUrl, 'https://www.zara.com/photos/2183/151/1.jpg');
  assert.equal(p.color, 'black');
  assert.equal(p.reference, '2183/151');
  assert.equal(p.category, 'dress');
  assert.equal(p.origin, 'jsonld');
});

test('product parser: falls back to Open Graph and to the URL reference; empty shell yields nothing', () => {
  const og = '<head><meta property="og:title" content="BLACK JEANS | ZARA"><meta property="og:image" content="https://static.zara.net/a.jpg"></head>';
  const p = parseProductHtml(og, PAGE);
  assert.equal(p.name, 'BLACK JEANS');
  assert.equal(p.origin, 'meta');
  assert.equal(p.category, 'bottom');
  assert.equal(p.reference, '2183/151');
  assert.equal(parseProductHtml('<html><body><div id="root"></div></body></html>', 'https://shop.example/x').origin, 'none');
  assert.equal(parseProductHtml('<meta property="og:image" content="http://insecure/x.jpg">', PAGE).imageUrl, undefined, 'http images dropped');
});

test('zara reference <-> url helpers; keyword inference', () => {
  assert.equal(zaraRefFromUrl(PAGE), '2183/151');
  assert.equal(zaraProductUrl('2183/151'), 'https://www.zara.com/il/he/-p02183151.html');
  assert.equal(zaraProductUrl('bad'), undefined);
  assert.equal(inferFromName('LEGGINGS SPORT').subtype, 'טייץ ספורט');
  assert.equal(inferFromName('CAMISA POPLIN').category, 'top');
  assert.equal(inferFromName('PANTALÓN RECTO').category, 'bottom');
  assert.equal(colorKeyFromText('Navy blue'), 'navy');
});

test('SSRF guard: only public HTTPS destinations', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) assert.equal(isPublicIp(ip), false, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700::1111']) assert.equal(isPublicIp(ip), true, ip);
  const bad = async (u: string, lookup = pub) => { try { await assertPublicUrl(u, lookup); return 'allowed'; } catch (e) { return (e as SafeFetchError).kind; } };
  assert.equal(await bad('http://www.zara.com/x'), 'invalid_url');
  assert.equal(await bad('ftp://x.com/'), 'invalid_url');
  assert.equal(await bad('https://user:pw@www.zara.com/'), 'invalid_url');
  assert.equal(await bad('https://www.zara.com:8443/'), 'invalid_url');
  assert.equal(await bad('https://localhost/'), 'blocked_destination');
  assert.equal(await bad('https://intranet/'), 'blocked_destination');
  assert.equal(await bad('https://127.0.0.1/'), 'blocked_destination');
  assert.equal(await bad('https://[::1]/'), 'blocked_destination');
  assert.equal(await bad('https://169.254.169.254/latest/meta-data'), 'blocked_destination');
  assert.equal(await bad('https://evil.example/', async () => ['10.0.0.5']), 'blocked_destination');
  assert.equal(await bad('https://evil.example/', async () => ['93.184.216.34', '127.0.0.1']), 'blocked_destination');
  assert.equal(await bad('https://www.zara.com/x'), 'allowed');
});

test('SSRF guard: every redirect hop is validated', async () => {
  const seen: string[] = [];
  const toMeta = fakeTransport({ 'https://a.example/': resp(302, '', { location: 'http://169.254.169.254/latest' }) }, seen);
  await assert.rejects(() => safeFetch('https://a.example/', { lookup: pub, transport: toMeta }), (e: SafeFetchError) => e.kind === 'invalid_url');
  assert.deepEqual(seen, ['https://a.example/'], 'blocked target is never requested');
  const lookup = async (h: string) => (h === 'internal.example' ? ['10.0.0.8'] : ['93.184.216.34']);
  const toInternal = fakeTransport({ 'https://a.example/': resp(301, '', { location: 'https://internal.example/admin' }) });
  await assert.rejects(() => safeFetch('https://a.example/', { lookup, transport: toInternal }), (e: SafeFetchError) => e.kind === 'blocked_destination');
  const loop = fakeTransport({ 'https://a.example/': resp(302, '', { location: '/' }) });
  await assert.rejects(() => safeFetch('https://a.example/', { lookup: pub, transport: loop }), (e: SafeFetchError) => e.kind === 'too_many_redirects');
  const ok = fakeTransport({ 'https://a.example/': resp(302, '', { location: '/b' }), 'https://a.example/b': resp(200, 'hi') });
  const r = await safeFetch('https://a.example/', { lookup: pub, transport: ok });
  assert.equal(r.finalUrl, 'https://a.example/b');
});

test('fetchProduct: ok / partial / blocked / removed / invalid', async () => {
  const img = Buffer.from([1, 2, 3]);
  const base = { 'https://www.zara.com/photos/2183/151/1.jpg': resp(200, img, { 'content-type': 'image/jpeg' }) };
  const ok = await fetchProduct(PAGE, { lookup: pub, transport: fakeTransport({ [PAGE]: resp(200, LD), ...base }) });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.product?.name, 'שמלה פופלין שחורה');
  assert.equal(ok.imageBase64, img.toString('base64'));
  const noImg = await fetchProduct(PAGE, { lookup: pub, transport: fakeTransport({ [PAGE]: resp(200, LD) }) });
  assert.equal(noImg.status, 'partial');
  assert.equal((await fetchProduct(PAGE, { lookup: pub, transport: fakeTransport({ [PAGE]: resp(403, 'Access Denied') }) })).status, 'blocked');
  assert.equal((await fetchProduct(PAGE, { lookup: pub, transport: fakeTransport({ [PAGE]: resp(200, '<html>Please complete the captcha</html>') }) })).status, 'blocked');
  assert.equal((await fetchProduct(PAGE, { lookup: pub, transport: fakeTransport({ [PAGE]: resp(200, '<html><div id="root"></div></html>') }) })).status, 'blocked');
  assert.equal((await fetchProduct(PAGE, { lookup: pub, transport: fakeTransport({ [PAGE]: resp(404) }) })).status, 'not_found');
  assert.equal((await fetchProduct('http://169.254.169.254/', {})).status, 'invalid_url');
  assert.equal((await product({ url: '' }, {})).status, 400);
});

// FIXTURE receipt text in a plausible shape (assumed, not a real Zara receipt).
const RECEIPT = `ZARA ISRAEL
סניף דיזנגוף
12/10/2026  14:32
ש.ז.ר.ה CAMISA POPLIN   1   2183/151/250   159.90
LEGGINGS SPORT 2 x 4387/402/800  99.90
שקית נייר 1 0.50
12345678901234
סה"כ לתשלום 259.30
VISA ****1234
`;

test('receipt parser keeps item lines, drops payment/total/barcode/date lines (fixture)', () => {
  const r = parseReceiptText(RECEIPT);
  assert.equal(r.store, 'zara');
  const refs = r.lines.map((l) => l.reference);
  assert.deepEqual(refs.filter(Boolean), ['2183/151', '4387/402']);
  assert.ok(!r.lines.some((l) => /VISA|סה"כ|12345678901234/.test(l.raw)));
  const leg = r.lines.find((l) => l.reference === '4387/402')!;
  assert.equal(leg.quantity, 2);
  assert.match(leg.description, /LEGGINGS SPORT/);
  assert.equal(leg.variant, '800');
});

test('receipt fingerprint detects the same receipt; differs for another', () => {
  const a = receiptFingerprint(parseReceiptText(RECEIPT).lines);
  assert.equal(a, receiptFingerprint(parseReceiptText(RECEIPT).lines.reverse()));
  assert.notEqual(a, receiptFingerprint(parseReceiptText('CAMISA LINO 1 1111/222/300 99.90').lines));
});

test('line matching: matched vs uncertain vs unmatched, and Zara candidate URL', () => {
  const [camisa, , ] = parseReceiptText(RECEIPT).lines;
  assert.equal(candidateUrl(camisa, 'zara'), 'https://www.zara.com/il/he/-p02183151.html');
  assert.equal(candidateUrl(camisa, undefined), undefined);
  const product = parseProductHtml(LD, PAGE);
  const m = classifyMatch(camisa, { status: 'ok', product, finalUrl: PAGE, imageBase64: 'QUJD', mediaType: 'image/jpeg' });
  assert.equal(m.status, 'matched');
  assert.equal(m.suggestion.color, 'black');
  const other = classifyMatch(camisa, { status: 'ok', product: { ...product, reference: '9999/111' }, finalUrl: PAGE });
  assert.equal(other.status, 'uncertain');
  const blocked = classifyMatch(camisa, { status: 'blocked' });
  assert.equal(blocked.status, 'uncertain');
  assert.match(blocked.note, /חסום/);
  assert.equal(blocked.suggestion.category, 'top');
  const junk = classifyMatch({ id: 'x', raw: '??', description: '', quantity: 1 }, null);
  assert.equal(junk.status, 'unmatched');
});

test('receipt image extraction is validated and never trusted blindly', async () => {
  const n = normalizeReceipt({ store: 'zara', lines: [{ description: 'CAMISA', quantity: 2, reference: '2183/151', price: '159.90' }, { description: '', reference: 'bad' }] });
  assert.equal(n?.lines.length, 1);
  assert.equal(n?.lines[0].reference, '2183/151');
  assert.equal(normalizeReceipt({ nope: 1 }), null);
  const reply = (async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"store":"zara","lines":[{"description":"LEGGINGS","quantity":1,"reference":"4387/402"}]}' }] }) })) as any;
  const out = await analyzeReceipt({ image: 'QUJD' }, { apiKey: 'k', fetchImpl: reply });
  assert.equal(out.status, 200);
  assert.equal((await analyzeReceipt({ image: 'QUJD' }, {})).status, 503);
});
