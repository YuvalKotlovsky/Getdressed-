import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeek } from '../src/logic/week';
import { DemoCalendarProvider } from './fixtures/demo';
import { demoModeData } from './fixtures/demo';
import { emptyModeData } from '../src/data/empty';
import { classifyTitle } from '../src/logic/classify';
import { choiceKey, planDay } from '../src/logic/recommend';
import { dateKey } from '../src/logic/dates';
import type { CalEvent, ModeData } from '../src/types';

const NOW = new Date(2026, 10, 2, 8, 0, 0); // Mon 2 Nov 2026, local
const provider = new DemoCalendarProvider(() => NOW);
const week = (d: ModeData) => buildWeek(provider, d, NOW);
const names = (e: { outfit: { items: { name: string }[] } }) => e.outfit.items.map((i) => i.name);

test('classifier handles Hebrew and English titles', () => {
  assert.equal(classifyTitle('פילאטיס').occasion, 'workout');
  assert.equal(classifyTitle('Gym').occasion, 'workout');
  assert.equal(classifyTitle('פגישה עם לקוח').occasion, 'work');
  assert.equal(classifyTitle('Team standup').occasion, 'work');
  assert.equal(classifyTitle('ארוחת ערב עם חברים').occasion, 'evening');
  assert.equal(classifyTitle('משהו לא ברור').confident, false);
});

test('meeting + workout on the same day give two relevant outfits', async () => {
  const w = await week(demoModeData());
  const day = w[0];
  assert.equal(day.entries.length, 2);
  const [meeting, workout] = day.entries;
  assert.equal(meeting.occasion, 'work');
  assert.equal(workout.occasion, 'workout');
  assert.ok(meeting.outfit.items.every((i) => i.category !== 'activewear' && i.dressiness >= 2));
  assert.equal(meeting.outfit.items.length, 3);
  assert.ok(workout.outfit.items.some((i) => i.category === 'activewear' && i.part === 'top'));
  assert.ok(workout.outfit.items.some((i) => i.category === 'activewear' && i.part === 'bottom'));
  assert.ok(workout.outfit.items.some((i) => i.name.includes('סניקרס')));
  assert.equal(meeting.outfit.missing.length + workout.outfit.missing.length, 0);
});

test('free days get a casual outfit from the closet', async () => {
  const w = await week(demoModeData());
  const free = w.find((d) => d.entries.every((e) => !e.event))!;
  assert.ok(free, 'demo week has a free day');
  assert.equal(free.entries[0].occasion, 'casual');
  assert.ok(free.entries[0].outfit.items.length >= 2);
});

test('moving a calendar event updates the affected days after refresh', async () => {
  const d = demoModeData();
  const before = await week(d);
  assert.equal(before[0].entries.filter((e) => e.event).length, 2);
  const moved: ModeData = { ...d, eventMoves: { 'demo-2': 1 } }; // pilates today -> tomorrow
  const after = await week(moved);
  assert.equal(after[0].entries.filter((e) => e.event).length, 1);
  assert.equal(after[1].entries.filter((e) => e.event).length, before[1].entries.filter((e) => e.event).length + 1);
  assert.ok(after[1].entries.some((e) => e.event?.title === 'פילאטיס'));
});

test('an unavailable item never appears in new suggestions (any variant)', async () => {
  const d = demoModeData();
  const first = (await week(d))[0].entries[0].outfit.items.map((i) => i.id);
  const blocked: ModeData = { ...d, items: d.items.map((i) => (first.includes(i.id) ? { ...i, available: false } : i)) };
  for (let v = 0; v < 6; v++) {
    const k = choiceKey(dateKey(NOW), 'demo-1');
    const w = await week({ ...blocked, choices: { [k]: { variant: v } } });
    for (const e of w.flatMap((x) => x.entries)) for (const it of e.outfit.items) assert.ok(!first.includes(it.id) || it.available);
    assert.ok(w[0].entries[0].outfit.items.every((i) => !first.includes(i.id)));
  }
});

test('"another look" yields a different valid combination', async () => {
  const d = demoModeData();
  const a = (await week(d))[0].entries[0];
  const k = choiceKey(dateKey(NOW), a.key);
  const b = (await week({ ...d, choices: { [k]: { variant: 1 } } }))[0].entries[0];
  assert.notDeepEqual(names(a), names(b));
  assert.ok(a.outfit.options > 1);
});

test('missing pieces are reported with the available ones', async () => {
  const d = demoModeData();
  const noSneakers: ModeData = { ...d, items: d.items.filter((i) => i.id !== 'd-sh-1') };
  const workout = (await week(noSneakers))[0].entries[1];
  assert.deepEqual(workout.outfit.missing, ['shoes']);
  assert.equal(workout.outfit.items.length, 2);
  assert.ok(workout.outfit.reason.length > 0);
});

test('empty closet: every entry explains what is missing, nothing crashes', async () => {
  const w = await buildWeek(provider, emptyModeData(), NOW);
  assert.ok(w[0].entries.every((e) => e.outfit.items.length === 0 && e.outfit.missing.length > 0));
});

test('saved outfit is kept and flagged when an item becomes unavailable', async () => {
  const d = demoModeData();
  const e = (await week(d))[0].entries[0];
  const ids = e.outfit.items.map((i) => i.id);
  const k = choiceKey(dateKey(NOW), e.key);
  const saved: ModeData = { ...d, choices: { [k]: { variant: 0, savedItemIds: ids, worn: true } } };
  let got = (await week(saved))[0].entries[0];
  assert.equal(got.saved, true);
  assert.equal(got.outfit.stale, undefined);
  const gone: ModeData = { ...saved, items: saved.items.map((i) => (i.id === ids[0] ? { ...i, available: false } : i)) };
  got = (await week(gone))[0].entries[0];
  assert.ok(got.outfit.stale && got.outfit.stale.length === 1);
});

test('worn history lowers recently worn items', async () => {
  const d = demoModeData();
  const first = (await week(d))[0].entries[0].outfit.items.map((i) => i.id);
  const worn: ModeData = { ...d, history: [{ dateKey: dateKey(new Date(2026, 10, 1)), itemIds: first }] };
  const next = (await week(worn))[0].entries[0].outfit.items.map((i) => i.id);
  assert.notDeepEqual(first, next);
});

test('manual events carry their chosen occasion', () => {
  const ev: CalEvent = { id: 'x', title: 'whatever', start: NOW.getTime(), end: NOW.getTime() + 1, calendarId: 'manual', occasion: 'workout' };
  const day = planDay(dateKey(NOW), [ev], { data: demoModeData(), today: dateKey(NOW) });
  assert.equal(day.entries[0].occasion, 'workout');
});
