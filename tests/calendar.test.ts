import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNativeEvents } from '../src/calendar/mapEvents';
import { CompositeCalendarProvider, ManualCalendarProvider, type CalendarProvider } from '../src/calendar/provider';
import { buildWeek } from '../src/logic/week';
import { demoModeData } from './fixtures/demo';
import type { CalEvent } from '../src/types';

const NOW = new Date(2026, 10, 2, 8, 0, 0);
const at = (day: number, h: number) => new Date(2026, 10, 2 + day, h).getTime();

test('native events are mapped, all-day items skipped, recurring instances get distinct ids', () => {
  const ev = mapNativeEvents([
    { id: 'a', title: 'פגישה עם לקוח', startDate: new Date(at(0, 10)), endDate: new Date(at(0, 11)), calendarId: 'c1' },
    { id: 'a', title: 'פגישה עם לקוח', startDate: new Date(at(1, 10)), endDate: new Date(at(1, 11)), calendarId: 'c1' },
    { id: 'b', title: 'יום הולדת', startDate: new Date(at(0, 0)), endDate: new Date(at(0, 23)), calendarId: 'c1', allDay: true },
    { id: 'c', title: '  ', startDate: new Date(at(0, 12)), endDate: new Date(at(0, 13)), calendarId: 'c2' },
  ]);
  assert.equal(ev.length, 3);
  assert.notEqual(ev[0].id, ev[1].id);
  assert.equal(ev[2].title, 'אירוע');
});

const fake = (events: CalEvent[], fail = false): CalendarProvider => ({
  id: 'native', isDemo: false, requestAccess: async () => true, listCalendars: async () => [],
  getEvents: async () => { if (fail) throw new Error('permission revoked'); return events; },
});

test('native + manual events are merged, classified on-device, and a failing source never hides manual events', async () => {
  const native = mapNativeEvents([{ id: 'p', title: 'Pilates', startDate: new Date(at(0, 18)), endDate: new Date(at(0, 19)), calendarId: 'c1' }]);
  const manual: CalEvent = { id: 'm1', title: 'פגישה עם לקוח', start: at(0, 10), end: at(0, 11), calendarId: 'manual' };
  const merged = new CompositeCalendarProvider([new ManualCalendarProvider(() => [manual]), fake(native)]);
  const week = await buildWeek(merged, demoModeData(), NOW);
  const occ = week[0].entries.map((e) => e.occasion);
  assert.deepEqual(occ, ['work', 'workout']);

  const denied = new CompositeCalendarProvider([new ManualCalendarProvider(() => [manual]), fake([], true)]);
  const w2 = await buildWeek(denied, demoModeData(), NOW);
  assert.equal(w2[0].entries.length, 1, 'manual event still planned when the calendar is unavailable');
});

test('moving a native event updates the affected days on the next refresh', async () => {
  const mk = (day: number): CalEvent[] => mapNativeEvents([{ id: 'p', title: 'Gym', startDate: new Date(at(day, 7)), endDate: new Date(at(day, 8)), calendarId: 'c1' }]);
  const before = await buildWeek(fake(mk(1)), demoModeData(), NOW);
  const after = await buildWeek(fake(mk(2)), demoModeData(), NOW);
  assert.equal(before[1].entries[0].occasion, 'workout');
  assert.equal(after[1].entries[0].event, null, 'old day is free again');
  assert.equal(after[2].entries[0].occasion, 'workout');
});
