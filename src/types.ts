export type Category = 'top' | 'bottom' | 'dress' | 'shoes' | 'activewear' | 'outerwear';
/** Which part of an outfit the item fills. Activewear can be a top or a bottom. */
export type Part = 'top' | 'bottom' | 'full' | 'shoes' | 'layer';
export type Occasion = 'work' | 'workout' | 'casual' | 'evening' | 'formal';
export type Weather = 'hot' | 'mild' | 'cold';
export interface WeatherPoint { temp: number; band: Weather; source: 'forecast' | 'season' | 'manual' }
export type Dressiness = 1 | 2 | 3; // 1 casual, 2 smart, 3 formal

export interface Item {
  id: string;
  name: string;
  category: Category;
  part: Part;
  color: string; // key of COLORS
  /** Hebrew subtype, e.g. טייץ ספורט (from recognition or manual entry) */
  subtype?: string;
  /** user-confirmed brand/model (suggested by recognition, never assumed) */
  brand?: string;
  model?: string;
  dressiness: Dressiness;
  occasions: Occasion[];
  /** Weather bands the item suits; missing = category default */
  weather?: Weather[];
  available: boolean;
  /** where the item came from (product link / receipt); never contains the receipt itself */
  source?: { store?: string; url?: string; reference?: string };
  favorite?: boolean;
  /** Local copy of the photo (file:// on device, data: URI on web). Never synced. */
  photoUri?: string;
  /** Object path of the photo in the private cloud bucket (`{user_id}/{item_id}/{photo_id}.jpg`). */
  photoPath?: string;
  /** test fixtures only */
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
  /** weather layer (jacket/coat) on top of the outfit */
  layer?: Item;
  layerNeed: 'none' | 'optional' | 'required';
  /** a required layer is needed (cold) but the closet has none */
  missingLayer?: boolean;
  weather: WeatherPoint;
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
  weather: WeatherPoint;
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

export interface Settings {
  cityId: string;
  /** manual weather override per date key */
  weatherOverride: Record<string, Weather>;
  /** native calendar (phone only): user chose to connect, and which calendars to read */
  calendarConnected?: boolean;
  calendarIds?: string[];
  /** fingerprints of receipts already imported (hashes only, never the receipt) */
  receiptFingerprints?: string[];
}

/** A change that has not reached the cloud yet. Survives app restarts; retried until it succeeds. */
export interface SyncOp {
  kind: 'upsert' | 'delete';
  attempts: number;
  lastError?: string;
  /** local photo waiting to be uploaded, and the photo id fixed for this attempt (retries reuse the same object path) */
  photoLocalUri?: string;
  photoId?: string;
  /** set once the photo object exists in the bucket (the row write may still be pending) */
  uploadedPath?: string;
  /** object paths to delete (best effort) once the row write succeeds */
  cleanup?: string[];
}

export interface SyncState {
  /** newest `updated_at` seen from the server */
  cursor?: string;
  pending: Record<string, SyncOp>;
}

/** Everything cached on this device for ONE signed-in account. */
export interface AppData {
  version: 2;
  userId: string;
  settings?: Settings;
  data: ModeData;
  sync: SyncState;
}
