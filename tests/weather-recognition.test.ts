import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeek } from '../src/logic/week';
import { DemoCalendarProvider } from '../src/calendar/provider';
import { demoModeData } from '../src/data/demo';
import { planDay, choiceKey } from '../src/logic/recommend';
import { dateKey } from '../src/logic/dates';
import { CITIES, bandOf, cityById, makeWeatherSource, parseOpenMeteo, seasonalTemp, fetchForecast } from '../src/weather/weather';
import { normalizeRecognition } from '../src/tagging/schema';
import { createRecognitionTagger, RecognitionError } from '../src/tagging/recognition';
import { analyze } from '../server/index';
import type { CalEvent, ModeData, WeatherPoint } from '../src/types';

const NOW = new Date(2026, 10, 2, 8, 0, 0); // Mon 2 Nov 2026
const D = dateKey(NOW);
const at = (h: number) => new Date(2026, 10, 2, h, 0).getTime();
const ev = (id: string, title: string, h: number): CalEvent => ({ id, title, start: at(h), end: at(h) + 3600000, calendarId: 'demo' });
const wx = (temp: number): WeatherPoint => ({ temp, band: bandOf(temp), source: 'forecast' });
const plan = (events: CalEvent[], data: ModeData, weather: (ms: number) => WeatherPoint) => planDay(D, events, { data, today: D, weather });
const ids = (e: { outfit: { items: { id: string }[]; layer?: { id: string } } }) => [...e.outfit.items.map((i) => i.id), ...(e.outfit.layer ? [e.outfit.layer.id] : [])];

test('Pilates on a cold day: leggings + sports top + sneakers, optional layer', () => {
  const [e] = plan([ev('a', 'פילאטיס', 18)], demoModeData(), () => wx(9)).entries;
  assert.equal(e.occasion, 'workout');
  assert.ok(e.outfit.items.some((i) => i.category === 'activewear' && i.part === 'bottom'));
  assert.ok(e.outfit.items.some((i) => i.category === 'activewear' && i.part === 'top'));
  assert.ok(e.outfit.items.some((i) => i.category === 'shoes' && i.name.includes('סניקרס')));
  assert.equal(e.outfit.layerNeed, 'optional');
  assert.equal(e.outfit.layer?.id, 'd-ou-3');
  assert.match(e.outfit.reason, /לדרך/);
});

test('no layer for a workout on a hot day', () => {
  const [e] = plan([ev('a', 'Gym', 7)], demoModeData(), () => wx(31)).entries;
  assert.equal(e.outfit.layerNeed, 'none');
  assert.equal(e.outfit.layer, undefined);
});

test('hot evening out prefers the lightweight dress', () => {
  const [e] = plan([ev('a', 'ארוחת ערב עם חברים', 20)], demoModeData(), () => wx(31)).entries;
  assert.equal(e.occasion, 'evening');
  assert.ok(e.outfit.items.some((i) => i.id === 'd-dr-3'), 'light dress chosen');
  assert.ok(!e.outfit.items.some((i) => i.id === 'd-dr-1'));
  assert.equal(e.outfit.layer, undefined);
  assert.match(e.outfit.reason, /השמלה מתאימה לבילוי/);
});

test('cool evening: dress + warm layer with Hebrew explanation', () => {
  const d = demoModeData();
  const dressesOnly: ModeData = { ...d, items: d.items.filter((i) => i.category !== 'top' && i.category !== 'bottom') };
  const [e] = plan([ev('a', 'ארוחת ערב', 20)], dressesOnly, () => wx(12)).entries;
  assert.ok(e.outfit.items.some((i) => i.part === 'full'));
  assert.ok(e.outfit.layer);
  assert.match(e.outfit.reason, /השמלה מתאימה לבילוי, וה.+ מוסיף שכבה לערב קר/);
});

test('dressy event on a cold evening: dress + warm coat; missing layer is reported', () => {
  const data = demoModeData();
  const [e] = plan([ev('w', 'חתונה של נועה', 19)], data, () => wx(8)).entries;
  assert.equal(e.occasion, 'formal');
  assert.equal(e.outfit.items[0].id, 'd-dr-4');
  assert.equal(e.outfit.layer?.id, 'd-ou-2');
  assert.equal(e.outfit.layerNeed, 'required');
  const noLayers: ModeData = { ...data, items: data.items.filter((i) => i.category !== 'outerwear') };
  const [m] = plan([ev('w', 'חתונה של נועה', 19)], noLayers, () => wx(8)).entries;
  assert.equal(m.outfit.layer, undefined);
  assert.equal(m.outfit.missingLayer, true);
  assert.ok(m.outfit.items.length > 0);
});

test('meeting + workout on one day use the weather at each event time', () => {
  const temps: Record<number, number> = { 10: 22, 18: 9 };
  const w = (ms: number) => wx(temps[new Date(ms).getHours()] ?? 20);
  const day = plan([ev('m', 'פגישה עם לקוח', 10), ev('p', 'פילאטיס', 18)], demoModeData(), w);
  assert.equal(day.entries.length, 2);
  assert.equal(day.entries[0].weather.temp, 22);
  assert.equal(day.entries[1].weather.temp, 9);
  assert.equal(day.entries[0].outfit.layer, undefined);
  assert.equal(day.entries[1].outfit.layerNeed, 'optional');
  assert.notDeepEqual(ids(day.entries[0]), ids(day.entries[1]));
});

test('unavailable items (including layers) are excluded from new outfits', () => {
  const data = demoModeData();
  const first = plan([ev('w', 'חתונה', 19)], data, () => wx(8)).entries[0];
  const blocked: ModeData = { ...data, items: data.items.map((i) => (ids(first).includes(i.id) ? { ...i, available: false } : i)) };
  const again = plan([ev('w', 'חתונה', 19)], blocked, () => wx(8)).entries[0];
  for (const id of ids(again)) assert.ok(!ids(first).includes(id));
});

test('forecast fallback: season estimate when there is no forecast, forecast and manual override otherwise', () => {
  const city = cityById('tlv');
  const none = makeWeatherSource({ city, forecast: null })(at(20));
  assert.equal(none.source, 'season');
  const f = parseOpenMeteo({ hourly: { time: ['2026-11-02T20:00'], temperature_2m: [13.4] } });
  assert.ok(f);
  const live = makeWeatherSource({ city, forecast: f })(at(20));
  assert.deepEqual([live.source, live.temp], ['forecast', 13]);
  assert.equal(makeWeatherSource({ city, forecast: f })(at(20) + 3 * 86400000).source, 'season', 'outside forecast range falls back');
  const manual = makeWeatherSource({ city, forecast: f, overrides: { [D]: 'hot' } })(at(20));
  assert.deepEqual([manual.source, manual.band], ['manual', 'hot']);
});

test('season estimate is sensible and every city works', () => {
  const tlv = cityById('tlv');
  assert.ok(seasonalTemp(tlv, new Date(2026, 7, 1, 15).getTime()) > seasonalTemp(tlv, new Date(2026, 0, 20, 21).getTime()) + 10);
  for (const c of CITIES) assert.ok(Number.isFinite(seasonalTemp(c, at(12))));
  assert.equal(parseOpenMeteo({}), null);
});

test('fetchForecast returns null on network failure or bad response', async () => {
  assert.equal(await fetchForecast(CITIES[0], (async () => { throw new Error('offline'); }) as any), null);
  assert.equal(await fetchForecast(CITIES[0], (async () => ({ ok: false })) as any), null);
});

test('buildWeek uses the weather source for all seven days', async () => {
  const w = await buildWeek(new DemoCalendarProvider(() => NOW), demoModeData(), NOW, () => wx(8));
  assert.ok(w.every((d) => d.entries.every((e) => e.weather.band === 'cold')));
});

test('leggings photo -> טייץ ספורט + workout', () => {
  const n = normalizeRecognition({ garment: true, category: 'activewear', subtype: 'טייץ ספורט', color: 'black', occasions: ['workout'], dressiness: 1, weather: ['mild', 'cold'], confidence: { category: 0.95, subtype: 0.9, color: 0.9, occasions: 0.9, dressiness: 0.9, weather: 0.7 } });
  assert.ok(n.ok);
  if (n.ok) {
    assert.equal(n.suggestion.subtype, 'טייץ ספורט');
    assert.equal(n.suggestion.part, 'bottom');
    assert.deepEqual(n.suggestion.occasions, ['workout']);
    assert.deepEqual(n.suggestion.uncertain, []);
  }
});

test('dress photo: several occasions, ambiguous fields are flagged', () => {
  const n = normalizeRecognition({ category: 'dress', subtype: 'שמלה', color: 'navy', occasions: ['evening', 'formal'], dressiness: 3, weather: ['mild'], confidence: { category: 0.9, subtype: 0.8, color: 0.8, occasions: 0.4, dressiness: 0.5, weather: 0.3 } });
  assert.ok(n.ok);
  if (n.ok) {
    assert.deepEqual(n.suggestion.occasions, ['evening', 'formal']);
    assert.deepEqual(n.suggestion.uncertain, ['occasions', 'dressiness', 'weather']);
  }
  assert.deepEqual(normalizeRecognition({ garment: false }), { ok: false, error: 'not_garment' });
  assert.deepEqual(normalizeRecognition({ category: 'spaceship' }), { ok: false, error: 'invalid' });
});

const modelReply = (obj: unknown) => (async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: 'Here: ' + JSON.stringify(obj) }] }) })) as any;

test('server: analyzes via the model API, keeps the key server-side, handles failures', async () => {
  let seen: any;
  const f = (async (url: string, init: any) => { seen = { url, init }; return (await modelReply({ category: 'activewear', subtype: 'טייץ ספורט', color: 'black', occasions: ['workout'], dressiness: 1, weather: ['mild'], confidence: {} })(url, init)); }) as any;
  const ok = await analyze({ image: 'QUJD', mediaType: 'image/jpeg' }, { apiKey: 'sk-test', fetchImpl: f });
  assert.equal(ok.status, 200);
  assert.equal(seen.init.headers['x-api-key'], 'sk-test');
  assert.ok(!JSON.stringify(ok.json).includes('sk-test'));
  assert.equal((await analyze({ image: 'QUJD' }, {})).status, 503);
  assert.equal((await analyze({ image: '<bad>' }, { apiKey: 'k' })).status, 400);
  assert.equal((await analyze({ image: 'QUJD' }, { apiKey: 'k', fetchImpl: (async () => { throw new Error('x'); }) as any })).status, 502);
  assert.equal((await analyze({ image: 'QUJD' }, { apiKey: 'k', fetchImpl: modelReply({ garment: false }) })).status, 422);
});

test('client tagger: success, and every failure mode raises a typed error (manual entry stays available)', async () => {
  const good = (async () => ({ ok: true, json: async () => ({ suggestion: { category: 'dress', subtype: 'שמלה', occasions: ['casual'], uncertain: [] } }) })) as any;
  const s = await createRecognitionTagger('http://x', good).suggest({ base64: 'QUJD', mediaType: 'image/jpeg' });
  assert.deepEqual([s.category, s.subtype, s.occasions, s.uncertain], ['dress', 'שמלה', ['casual'], []]);
  const kind = async (impl: any, url: string | undefined = 'http://x') => {
    try { await createRecognitionTagger(url, impl).suggest({ base64: 'QUJD', mediaType: 'image/jpeg' }); return 'ok'; } catch (e) { return (e as RecognitionError).kind; }
  };
  assert.equal(await kind((async () => { throw new Error('offline'); }) as any), 'network');
  assert.equal(await kind((async () => ({ ok: false, json: async () => ({ error: 'upstream' }) })) as any), 'server');
  assert.equal(await kind((async () => ({ ok: false, json: async () => ({ error: 'not_garment' }) })) as any), 'not_garment');
  assert.equal(await kind(good, ''), 'not_configured');
});

test('a corrected tag survives save/reload and changes future recommendations', () => {
  const data = demoModeData();
  // user corrects the casual summer dress to "evening" + hot
  const corrected: ModeData = { ...data, items: data.items.map((i) => (i.id === 'd-dr-2' ? { ...i, occasions: ['evening'] as any, dressiness: 2, weather: ['hot'] as any, subtype: 'שמלת ערב קלה' } : i)) };
  const reopened: ModeData = JSON.parse(JSON.stringify(corrected)); // what AsyncStorage round-trips
  const dress = reopened.items.find((i) => i.id === 'd-dr-2')!;
  assert.deepEqual([dress.occasions, dress.subtype], [['evening'], 'שמלת ערב קלה']);
  const e = plan([ev('a', 'ארוחת ערב', 21)], reopened, () => wx(33)).entries[0];
  assert.ok(e.outfit.items.some((i) => i.id === 'd-dr-2'), 'corrected dress is now an evening option on a hot night');
  void choiceKey;
});
