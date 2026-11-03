import { COLORS } from '../theme';
import type { Category, Dressiness, Occasion, Part, Weather } from '../types';

/** Fields the recognizer can fill and that the editor can flag as uncertain. */
export type TagField = 'category' | 'subtype' | 'color' | 'occasions' | 'dressiness' | 'weather';

export interface BrandGuess { brand: string; model?: string; source: 'caption' | 'logo' | 'shape' }

export interface TagSuggestion {
  category?: Category;
  part?: Part;
  subtype?: string;
  color?: string;
  dressiness?: Dressiness;
  occasions?: Occasion[];
  weather?: Weather[];
  /** possible brand/model for the user to CONFIRM; never saved automatically */
  brand?: BrandGuess;
  /** more than one garment was visible; the suggestion is for the main (foreground) item */
  multiple?: boolean;
  /** fields the recognizer was unsure about or could not read: show them for review */
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

/** Canonical Hebrew shoe/garment subtypes the model should choose from (free text allowed when none fits). */
const SUBTYPE_HINT = 'shoes: סניקרס | נעלי עור | נעלי עקב | בלרינות | מגפונים | מגפיים | סנדלים | כפכף | כפכף סגור / קלוג; top: חולצה | חולצה מכופתרת | טי שירט | סוודר | סווטשירט | גופייה; bottom: ג׳ינס | מכנסי בד | חצאית | שורט; dress: שמלה | שמלת מידי | שמלת מקסי; activewear: טייץ ספורט | גופיית ספורט | חולצת ספורט | מכנסי ספורט; outerwear: ז׳קט | מעיל | בלייזר | קרדיגן';

/** Instruction for the vision model. The model sees one photo (or screenshot) and must tag ONE main garment. */
export const RECOGNITION_PROMPT = `You are a clothing tagger for a Hebrew wardrobe app. The image is a photo or a phone screenshot (it may include status bars, app buttons, captions or stickers).
Tag exactly ONE garment: the MAIN item held, worn or shown in the foreground (largest, closest, in focus, usually near the centre or held in a hand). Ignore hands, backgrounds, shelves, other products and other people's clothes. If several garments are visible, still describe the main one and set "multiple":true.
Reply with JSON only, no prose, exactly this shape:
{"garment":true|false,
 "multiple":true|false,
 "category":"top|bottom|dress|shoes|activewear|outerwear",
 "subtype":"short Hebrew name; prefer one of: ${SUBTYPE_HINT}",
 "color":"${Object.keys(COLORS).join('|')}",
 "occasions":["work|workout|casual|evening|formal", ...],
 "dressiness":1|2|3,
 "weather":["hot|mild|cold", ...],
 "brand":null | {"brand":"Birkenstock","model":"Boston","source":"caption|logo|shape"},
 "confidence":{"category":0-1,"subtype":0-1,"color":0-1,"occasions":0-1,"dressiness":0-1,"weather":0-1,"brand":0-1}}
Rules:
- category "activewear" is for athletic leggings, sports tops and tanks (occasions must include "workout"). Athletic leggings => subtype "טייץ ספורט", occasions ["workout"].
- Closed-toe backless slip-ons (clogs such as Birkenstock Boston) are category "shoes", subtype "כפכף סגור / קלוג", usually casual, dressiness 1.
- Dresses: choose any of casual (יום־יום), evening (בילוי), formal (אירוע חגיגי) from visible cut, length, fabric and details.
- color is the main colour of the garment itself as it really looks (not tinted by lighting). dark/midnight/navy blue => "navy"; mid or bright blue => "blue"; denim fabric => "denim".
- dressiness: 1 casual, 2 smart, 3 formal. weather: temperatures the garment suits (hot = light/open/airy, cold = heavy/closed/warm, suede closed shoes => mild and cold).
- brand: only if a brand or model is NAMED in a visible caption/text (source "caption"), shown by a visible logo (source "logo"), or the design is unmistakable (source "shape", confidence <= 0.6). Otherwise null. Never guess a brand from colour alone. Captions may be Hebrew (e.g. בירקנשטוק בוסטון = Birkenstock Boston); write the brand in English.
- Use low confidence (<0.6) when ambiguous, blurry or partly hidden. If there is no single garment, set "garment":false.`;

export function extractJson(text: string): unknown {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

const SUBTYPE_ALIASES: [RegExp, string][] = [
  [/קלוג|כפכף סגור|clog|boston|mule/i, 'כפכף סגור / קלוג'],
  [/sneaker|סניקרס|נעלי ספורט/i, 'סניקרס'],
  [/leggings|טייץ/i, 'טייץ ספורט'],
];
export function canonicalSubtype(s?: string): string | undefined {
  if (!s) return undefined;
  return SUBTYPE_ALIASES.find(([re]) => re.test(s))?.[1] ?? s;
}

export function normalizeBrand(b: unknown, confidence: unknown): BrandGuess | undefined {
  const r = b as any;
  if (!r || typeof r !== 'object' || typeof r.brand !== 'string' || !r.brand.trim()) return undefined;
  if (typeof confidence === 'number' && confidence < 0.4) return undefined;
  const source = ['caption', 'logo', 'shape'].includes(r.source) ? r.source : 'shape';
  return { brand: r.brand.trim().slice(0, 40), model: typeof r.model === 'string' && r.model.trim() ? r.model.trim().slice(0, 40) : undefined, source };
}

export type NormalizeResult = { ok: true; suggestion: TagSuggestion } | { ok: false; error: 'not_garment' | 'invalid' };

export function normalizeRecognition(raw: unknown): NormalizeResult {
  const r = raw as any;
  if (!r || typeof r !== 'object') return { ok: false, error: 'invalid' };
  if (r.garment === false) return { ok: false, error: 'not_garment' };
  if (!CATEGORIES.includes(r.category)) return { ok: false, error: 'invalid' };
  const category = r.category as Category;
  const subtype = canonicalSubtype(typeof r.subtype === 'string' ? r.subtype.trim().slice(0, 40) : undefined);
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
      brand: normalizeBrand(r.brand, r.confidence?.brand),
      multiple: r.multiple === true ? true : undefined,
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
    brand: normalizeBrand(r.brand, undefined),
    multiple: r.multiple === true ? true : undefined,
    uncertain: Array.isArray(r.uncertain) ? r.uncertain.filter((f: TagField) => fields.includes(f)) : [],
  };
}
