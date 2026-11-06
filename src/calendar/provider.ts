import type { CalEvent } from '../types';
import { addDays, startOfDay } from '../logic/dates';

/**
 * Calendar seam. The UI/planner only talks to this interface.
 * Providers: manual events and the phone calendar (expo-calendar).
 */
export interface CalendarInfo { id: string; title: string }

export interface CalendarProvider {
  readonly id: 'manual' | 'native';
  readonly isDemo: boolean;
  requestAccess(): Promise<boolean>;
  listCalendars(): Promise<CalendarInfo[]>;
  getEvents(from: Date, to: Date, calendarIds?: string[]): Promise<CalEvent[]>;
}

/** Used for "my closet" until native calendar access exists: events the user typed in. */
export class ManualCalendarProvider implements CalendarProvider {
  readonly id = 'manual' as const;
  readonly isDemo = false;
  constructor(private events: () => CalEvent[]) {}
  async requestAccess() { return true; }
  async listCalendars() { return [{ id: 'manual', title: 'אירועים ידניים' }]; }
  async getEvents(from: Date, to: Date) {
    return this.events().filter((e) => e.start >= from.getTime() && e.start < to.getTime());
  }
}

export const weekRange = (now = new Date()): [Date, Date] => {
  const s = startOfDay(now);
  return [s, addDays(s, 7)];
};

/** Merges several providers; one failing (permission revoked, calendar removed) never hides the others. */
export class CompositeCalendarProvider implements CalendarProvider {
  readonly id = 'manual' as const;
  readonly isDemo = false;
  constructor(private parts: CalendarProvider[]) {}
  async requestAccess() { return true; }
  async listCalendars() { return (await Promise.all(this.parts.map((p) => p.listCalendars().catch(() => [])))).flat(); }
  async getEvents(from: Date, to: Date, ids?: string[]) {
    const all = await Promise.all(this.parts.map((p) => p.getEvents(from, to, ids).catch(() => [] as CalEvent[])));
    return all.flat();
  }
}
