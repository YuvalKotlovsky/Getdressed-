export type Category = 'top' | 'bottom' | 'dress' | 'shoes' | 'activewear';
/** Which part of an outfit the item fills. Activewear can be a top or a bottom. */
export type Part = 'top' | 'bottom' | 'full' | 'shoes';
export type Occasion = 'work' | 'workout' | 'casual' | 'evening';
export type Dressiness = 1 | 2 | 3; // 1 casual, 2 smart, 3 formal

export interface Item {
  id: string;
  name: string;
  category: Category;
  part: Part;
  color: string; // key of COLORS
  dressiness: Dressiness;
  occasions: Occasion[];
  available: boolean;
  favorite?: boolean;
  /** Local photo (file:// on device, data: URI on web). Demo items have none. */
  photoUri?: string;
  demo?: boolean;
}

export interface CalEvent {
  id: string;
  title: string;
  start: number; // epoch ms
  end: number;
  calendarId: string;
  /** manual events carry their chosen occasion */
  occasion?: Occasion;
}

export interface Classification {
  occasion: Occasion;
  dressiness: Dressiness;
  /** false when the title was not recognised: ask the user to confirm */
  confident: boolean;
}

export type MissingPart = Part;

export interface Outfit {
  items: Item[];
  missing: MissingPart[];
  reason: string;
  /** number of distinct valid combinations, used to know whether "another look" can change anything */
  options: number;
  /** set when the user saved this outfit and one of its items is gone/unavailable */
  stale?: string[];
}

export interface PlanEntry {
  key: string; // event id or `free`
  event: CalEvent | null;
  occasion: Occasion;
  dressiness: Dressiness;
  confident: boolean;
  outfit: Outfit;
  saved: boolean;
  worn: boolean;
}

export interface DayPlan {
  dateKey: string;
  entries: PlanEntry[];
}

export interface Choice {
  variant: number;
  /** Items the user locked in with "לבשתי"/save. */
  savedItemIds?: string[];
  worn?: boolean;
}

export interface HistoryEntry {
  dateKey: string;
  itemIds: string[];
}

export interface ModeData {
  items: Item[];
  choices: Record<string, Choice>; // `${dateKey}|${entryKey}`
  history: HistoryEntry[];
  occasionOverrides: Record<string, Occasion>; // by event id
  manualEvents: CalEvent[];
  eventMoves: Record<string, number>; // demo only: event id -> extra days moved
}

export type Mode = 'demo' | 'mine';

export interface AppData {
  version: 1;
  mode: Mode;
  demo: ModeData;
  mine: ModeData;
}
