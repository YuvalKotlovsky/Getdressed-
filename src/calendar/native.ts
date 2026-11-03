import { Platform } from 'react-native';
import type { CalEvent } from '../types';
import type { CalendarInfo, CalendarProvider } from './provider';

export type CalendarPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** Lazy require keeps expo-calendar out of the web bundle path and out of tests. */
const lib = () => require('expo-calendar/legacy') as typeof import('expo-calendar/legacy');

export const nativeCalendarSupported = Platform.OS === 'ios' || Platform.OS === 'android';

export async function getCalendarPermission(): Promise<CalendarPermission> {
  if (!nativeCalendarSupported) return 'unavailable';
  try {
    const r = await lib().getCalendarPermissionsAsync();
    return r.granted ? 'granted' : r.canAskAgain === false || r.status === 'denied' ? 'denied' : 'undetermined';
  } catch { return 'unavailable'; }
}

export async function requestCalendarPermission(): Promise<CalendarPermission> {
  if (!nativeCalendarSupported) return 'unavailable';
  try {
    const r = await lib().requestCalendarPermissionsAsync();
    return r.granted ? 'granted' : 'denied';
  } catch { return 'unavailable'; }
}

export { mapNativeEvents, type RawNativeEvent } from './mapEvents';
import { mapNativeEvents, type RawNativeEvent } from './mapEvents';

/** Reads events locally from the phone's calendars (never uploaded). Only the calendars the user selected. */
export class NativeCalendarProvider implements CalendarProvider {
  readonly id = 'native' as const;
  readonly isDemo = false;
  constructor(private selected: () => string[]) {}
  async requestAccess() { return (await requestCalendarPermission()) === 'granted'; }
  async listCalendars(): Promise<CalendarInfo[]> {
    if ((await getCalendarPermission()) !== 'granted') return [];
    const cals = await lib().getCalendarsAsync(lib().EntityTypes.EVENT);
    return cals.map((c) => ({ id: c.id, title: c.source?.name && c.source.name !== c.title ? `${c.title} (${c.source.name})` : c.title }));
  }
  async getEvents(from: Date, to: Date, calendarIds?: string[]): Promise<CalEvent[]> {
    const ids = calendarIds ?? this.selected();
    if (!ids.length || (await getCalendarPermission()) !== 'granted') return [];
    const raw = await lib().getEventsAsync(ids, from, to);
    return mapNativeEvents(raw as unknown as RawNativeEvent[]);
  }
}
