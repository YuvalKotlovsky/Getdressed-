import { COLORS } from '../theme';
import type { Category, Dressiness, Occasion, Part, Weather } from '../types';

/** Fields the recognizer can fill and that the editor can flag as uncertain. */
export type TagField = 'category' | 'subtype' | 'color' | 'occasions' | 'dressiness' | 'weather';

export interface TagSuggestion {
  category?: Category;
  part?: Part;
  subtype?: string;
  color?: string;
  dressiness?: Dressiness;
  occasions?: Occasion[];
  weather?: Weather[];
  /** fields the recognizer was unsure about: show them for review */
  uncertain?: TagField[];
}

export const CATEGORIES: Category[] = ['top', 'bottom', 'dress', 'shoes', 'activewear', 'outerwear'];
const OCCASIONS: Occasion[] = ['work', 'workout', 'casual', 'evening', 'formal'];
const WEATHERS: Weather[] = ['hot', 'mild', 'cold'];
export const UNCERTAIN_BELOW = 0.6;

export const partForCategory = (c: Category, subtype = ''): Part => {
  switch (c) {
    case 'top': return 'top';
    case 'bottom': return 'bottom';
    case 'dress': return 'full';
    case 'shoes': return 'shoes';
    case 'outerwear': return 'layer';
    case 'activewear':
      return /טייץ|מכנס|שורט|חצאית|leggings|shorts|pants|tights/i.test(subtype) ? 'bottom' : 'top';
  }
};

/** Instruction for the vision model. The model only ever sees one garment photo. */
export const RECOGNITION_PROMPT = `You are a clothing tagger for a Hebrew wardrobe app. The image shows ONE garment (a photo of a single clothing item).
Reply with JSON only, no prose, exactly this shape:
{"garment":true|false,
 "category":"top|bottom|dress|shoes|activewear|outerwear",
 "subtype":"short Hebrew name, e.g. טייץ ספורט, גופיית ספורט, חולצה מכופתרת, ג׳ינס, שמלה, ז׳קט, סניקרס",
 "color":"${Object.keys(COLORS).join('|')}",
 "occasions":["work|workout|casual|evening|formal", ...],
 "dressiness":1|2|3,
 "weather":["hot|mild|cold", ...],
 "confidence":{"category":0-1,"subtype":0-1,"color":0-1,"occasions":0-1,"dressiness":0-1,"weather":0-1}}
Rules: category "activewear" is for athletic leggings, sports tops and tanks (then occasions must include "workout"). Athletic leggings => subtype "טייץ ספורט", occasions ["workout"]. For dresses choose any of casual (יום־יום), evening (בילוי), formal (אירוע חגיגי) from visible cut, length, fabric and details. dressiness: 1 casual, 2 smart, 3 formal. weather: the temperatures the garment suits (hot = light/short/airy, cold = heavy/long/warm). Use low confidence (<0.6) when the image is ambiguous, unclear, or the garment is partly hidden. If the image is not a single garment, set "garment":false.`;

export function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export type NormalizeResult = { ok: true; suggestion: TagSuggestion } | { ok: false; error: 'not_garment' | 'invalid' };

export function normalizeRecognition(raw: unknown): NormalizeResult {
  const r = raw as any;
  if (!r || typeof r !== 'object') return { ok: false, error: 'invalid' };
  if (r.garment === false) return { ok: false, error: 'not_garment' };
  if (!CATEGORIES.includes(r.category)) return { ok: false, error: 'invalid' };
  const category = r.category as Category;
  const subtype = typeof r.subtype === 'string' ? r.subtype.trim().slice(0, 40) : undefined;
  const color = typeof r.color === 'string' && COLORS[r.color] ? r.color : undefined;
  const occasions = Array.isArray(r.occasions) ? ([...new Set(r.occasions)].filter((o) => OCCASIONS.includes(o as Occasion)) as Occasion[]) : [];
  const weather = Array.isArray(r.weather) ? ([...new Set(r.weather)].filter((w) => WEATHERS.includes(w as Weather)) as Weather[]) : [];
  const dressiness = [1, 2, 3].includes(r.dressiness) ? (r.dressiness as Dressiness) : undefined;
  if (category === 'activewear' && !occasions.includes('workout')) occasions.push('workout');

  const conf = (k: string) => (typeof r.confidence?.[k] === 'number' ? r.confidence[k] : 0.5);
  const uncertain: TagField[] = [];
  const check = (k: TagField, present: boolean) => { if (!present || conf(k) < UNCERTAIN_BELOW) uncertain.push(k); };
  check('category', true);
  check('subtype', !!subtype);
  check('color', !!color);
  check('occasions', occasions.length > 0);
  check('dressiness', !!dressiness);
  check('weather', weather.length > 0);

  return {
    ok: true,
    suggestion: {
      category, subtype, color, dressiness, part: partForCategory(category, subtype),
      occasions: occasions.length ? occasions : undefined,
      weather: weather.length ? weather : undefined,
      uncertain,
    },
  };
}

/** Validates a suggestion already normalized by the server (keeps its `uncertain` list). */
export function sanitizeSuggestion(raw: unknown): TagSuggestion | null {
  const r = raw as any;
  if (!r || !CATEGORIES.includes(r.category)) return null;
  const subtype = typeof r.subtype === 'string' ? r.subtype.trim().slice(0, 40) : undefined;
  const list = <T extends string>(v: unknown, allowed: T[]) => (Array.isArray(v) ? ([...new Set(v)].filter((x) => allowed.includes(x as T)) as T[]) : []);
  const occasions = list<Occasion>(r.occasions, OCCASIONS);
  const weather = list<Weather>(r.weather, WEATHERS);
  const fields: TagField[] = ['category', 'subtype', 'color', 'occasions', 'dressiness', 'weather'];
  return {
    category: r.category, subtype, part: partForCategory(r.category, subtype),
    color: typeof r.color === 'string' && COLORS[r.color] ? r.color : undefined,
    dressiness: [1, 2, 3].includes(r.dressiness) ? r.dressiness : undefined,
    occasions: occasions.length ? occasions : undefined,
    weather: weather.length ? weather : undefined,
    uncertain: Array.isArray(r.uncertain) ? r.uncertain.filter((f: TagField) => fields.includes(f)) : [],
  };
}
