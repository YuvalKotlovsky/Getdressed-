import type { CalendarProvider } from '../calendar/provider';
import type { CalEvent, DayPlan, ModeData } from '../types';
import { addDays, dateKey, startOfDay } from './dates';
import { planDay } from './recommend';

/** Loads events from the provider, applies local moves, and plans today + 6 days. */
export async function buildWeek(provider: CalendarProvider, data: ModeData, now: Date = new Date()): Promise<DayPlan[]> {
  const today = startOfDay(now);
  const raw = await provider.getEvents(addDays(today, -7), addDays(today, 14));
  const events: CalEvent[] = raw.map((e) => {
    const mv = data.eventMoves[e.id];
    if (!mv) return e;
    const s = addDays(e.start, mv).getTime();
    return { ...e, start: s, end: s + (e.end - e.start) };
  });
  const todayKey = dateKey(today);
  const days: DayPlan[] = [];
  for (let i = 0; i < 7; i++) {
    const k = dateKey(addDays(today, i));
    const evs = events.filter((e) => dateKey(e.start) === k);
    days.push(planDay(k, evs, { data, today: todayKey }));
  }
  return days;
}
