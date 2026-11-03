import type { CalEvent } from '../types';

export interface RawNativeEvent { id: string; title?: string; startDate: string | Date; endDate: string | Date; calendarId: string; allDay?: boolean }

/** Pure mapping, unit-tested. All-day items (birthdays, holidays) have no time of day, so they are skipped. */
export function mapNativeEvents(raw: RawNativeEvent[]): CalEvent[] {
  return raw
    .filter((e) => !e.allDay)
    .map((e) => {
      const start = new Date(e.startDate).getTime();
      const end = new Date(e.endDate).getTime();
      return { id: `cal-${e.id}-${start}`, title: (e.title ?? '').trim() || 'אירוע', start, end: Number.isFinite(end) ? end : start + 3600000, calendarId: e.calendarId } as CalEvent;
    })
    .filter((e) => Number.isFinite(e.start));
}

