import type { CalEvent, Item, ModeData, Occasion } from '../types';
import { addDays, startOfDay } from '../logic/dates';

type D = Omit<Item, 'available' | 'demo'>;
const raw: D[] = [
  { id: 'd-top-1', name: 'חולצה מכופתרת לבנה', category: 'top', part: 'top', color: 'white', dressiness: 2, occasions: ['work', 'evening'], favorite: true },
  { id: 'd-top-2', name: 'חולצה מכופתרת תכלת', category: 'top', part: 'top', color: 'blue', dressiness: 2, occasions: ['work', 'casual'] },
  { id: 'd-top-3', name: 'חולצת טי לבנה', category: 'top', part: 'top', color: 'white', dressiness: 1, occasions: ['casual'] },
  { id: 'd-top-4', name: 'סוודר אפור', category: 'top', part: 'top', color: 'gray', dressiness: 2, occasions: ['work', 'casual', 'evening'] },
  { id: 'd-top-5', name: 'חולצה שחורה אלגנטית', category: 'top', part: 'top', color: 'black', dressiness: 3, occasions: ['evening', 'work'] },
  { id: 'd-bot-1', name: 'ג׳ינס כחול כהה', category: 'bottom', part: 'bottom', color: 'denim', dressiness: 2, occasions: ['work', 'casual', 'evening'], favorite: true },
  { id: 'd-bot-2', name: 'מכנסי בד שחורים', category: 'bottom', part: 'bottom', color: 'black', dressiness: 3, occasions: ['work', 'evening'] },
  { id: 'd-bot-3', name: 'ג׳ינס בהיר', category: 'bottom', part: 'bottom', color: 'denim', dressiness: 1, occasions: ['casual'] },
  { id: 'd-bot-4', name: 'מכנסיים בז׳', category: 'bottom', part: 'bottom', color: 'beige', dressiness: 2, occasions: ['work', 'casual'] },
  { id: 'd-dr-1', name: 'שמלה שחורה', category: 'dress', part: 'full', color: 'black', dressiness: 3, occasions: ['evening', 'work'] },
  { id: 'd-dr-2', name: 'שמלת קיץ ירוקה', category: 'dress', part: 'full', color: 'green', dressiness: 1, occasions: ['casual'] },
  { id: 'd-sh-1', name: 'סניקרס לבנים', category: 'shoes', part: 'shoes', color: 'white', dressiness: 1, occasions: ['casual', 'workout'] },
  { id: 'd-sh-2', name: 'נעלי עור חומות', category: 'shoes', part: 'shoes', color: 'brown', dressiness: 3, occasions: ['work', 'evening'] },
  { id: 'd-sh-3', name: 'מגפונים שחורים', category: 'shoes', part: 'shoes', color: 'black', dressiness: 2, occasions: ['evening', 'casual', 'work'] },
  { id: 'd-ac-1', name: 'טייץ שחור', category: 'activewear', part: 'bottom', color: 'black', dressiness: 1, occasions: ['workout'] },
  { id: 'd-ac-2', name: 'גופייה ורודה', category: 'activewear', part: 'top', color: 'pink', dressiness: 1, occasions: ['workout'] },
  { id: 'd-ac-3', name: 'גופייה אפורה', category: 'activewear', part: 'top', color: 'gray', dressiness: 1, occasions: ['workout'] },
];

export const demoItems = (): Item[] => raw.map((r) => ({ ...r, available: true, demo: true }));

export const emptyModeData = (items: Item[] = []): ModeData => ({
  items, choices: {}, history: [], occasionOverrides: {}, manualEvents: [], eventMoves: {},
});

export const demoModeData = (): ModeData => emptyModeData(demoItems());

/** Sample week relative to today so it is always current. Includes a meeting + workout on day 0. */
export function demoEvents(now: Date = new Date()): CalEvent[] {
  const day0 = startOfDay(now);
  const mk = (id: string, dayOff: number, h: number, m: number, mins: number, title: string): CalEvent => {
    const s = addDays(day0, dayOff);
    s.setHours(h, m, 0, 0);
    return { id, title, start: s.getTime(), end: s.getTime() + mins * 60000, calendarId: 'demo' };
  };
  return [
    mk('demo-1', 0, 10, 0, 60, 'פגישה עם לקוח'),
    mk('demo-2', 0, 18, 0, 60, 'פילאטיס'),
    mk('demo-3', 1, 7, 30, 60, 'Gym'),
    mk('demo-4', 2, 9, 30, 30, 'Team standup'),
    mk('demo-5', 2, 20, 0, 120, 'ארוחת ערב עם חברים'),
    mk('demo-6', 4, 11, 0, 90, 'ביקור אצל סבתא'),
    mk('demo-7', 6, 13, 0, 90, 'Brunch'),
  ];
}

export const manualOccasions: Occasion[] = ['work', 'workout', 'casual', 'evening'];
