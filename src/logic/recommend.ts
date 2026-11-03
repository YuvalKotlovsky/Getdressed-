import { COLORS } from '../theme';
import { classifyTitle, defaultDressiness } from './classify';
import { daysDiff } from './dates';
import type {
  CalEvent, Category, Choice, DayPlan, HistoryEntry, Item, MissingPart, ModeData, Occasion, Outfit, Part,
  PlanEntry, Weather, WeatherPoint,
} from '../types';

/** Dressiness window accepted for an occasion. */
const WINDOW: Record<Occasion, [number, number]> = {
  work: [2, 3],
  evening: [2, 3],
  casual: [1, 2],
  workout: [1, 3],
  formal: [3, 3],
};

const DEFAULT_WEATHER: Record<Category, Weather[]> = {
  top: ['hot', 'mild', 'cold'],
  bottom: ['hot', 'mild', 'cold'],
  dress: ['hot', 'mild', 'cold'],
  shoes: ['hot', 'mild', 'cold'],
  activewear: ['hot', 'mild', 'cold'],
  outerwear: ['mild', 'cold'],
};
export const weatherOf = (i: Item): Weather[] => (i.weather && i.weather.length ? i.weather : DEFAULT_WEATHER[i.category]);

const NO_WEATHER: WeatherPoint = { temp: 21, band: 'mild', source: 'season' };

/** Does the item's tags/dressiness fit the occasion? (ignores category rules) */
function fitsOccasion(item: Item, occasion: Occasion): boolean {
  const o = item.occasions;
  switch (occasion) {
    case 'workout':
      return o.includes('workout');
    case 'formal':
      if (!(o.includes('formal') || (o.includes('evening') && item.dressiness === 3))) return false;
      break;
    case 'evening':
      if (!(o.includes('evening') || o.includes('formal'))) return false;
      break;
    default:
      if (!o.includes(occasion)) return false;
  }
  const [lo, hi] = WINDOW[occasion];
  return item.dressiness >= lo && item.dressiness <= hi;
}

/** Main-outfit eligibility (tops, bottoms, dresses, shoes). Layers are chosen separately. */
export function eligible(item: Item, occasion: Occasion): boolean {
  if (!item.available || item.category === 'outerwear') return false;
  const isActive = item.category === 'activewear';
  if (occasion === 'workout') {
    if (item.part === 'shoes') return item.occasions.includes('workout');
    return isActive;
  }
  if (isActive) return false;
  return fitsOccasion(item, occasion);
}

function layerEligible(item: Item, occasion: Occasion): boolean {
  if (!item.available || item.category !== 'outerwear') return false;
  if (occasion === 'workout') return item.occasions.includes('workout');
  return fitsOccasion(item, occasion);
}

function colorPairScore(a: string, b: string): number {
  const ca = COLORS[a];
  const cb = COLORS[b];
  if (!ca || !cb) return 0;
  if (a === b) return 0.5;
  if (ca.neutral && cb.neutral) {
    if ((a === 'black' && b === 'brown') || (a === 'brown' && b === 'black')) return -1;
    if ((a === 'black' && b === 'navy') || (a === 'navy' && b === 'black')) return -0.5;
    return 1;
  }
  if (ca.neutral || cb.neutral) return 1;
  return -1.5; // two different bright colours
}

export function colorScore(items: Item[]): number {
  let s = 0;
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) s += colorPairScore(items[i].color, items[j].color);
  }
  return s;
}

function recencyPenalty(items: Item[], history: HistoryEntry[], today: string): number {
  let p = 0;
  for (const it of items) {
    for (const h of history) {
      if (!h.itemIds.includes(it.id)) continue;
      const ago = daysDiff(h.dateKey, today);
      if (ago >= 0 && ago <= 2) p += 3;
      else if (ago > 2 && ago <= 7) p += 1.5;
    }
  }
  return p;
}

function combos(lists: Item[][]): Item[][] {
  return lists.reduce<Item[][]>((acc, list) => acc.flatMap((a) => list.map((x) => [...a, x])), [[]]);
}

export interface RankInput {
  items: Item[];
  occasion: Occasion;
  dressiness: number;
  history: HistoryEntry[];
  today: string;
  usedToday?: Set<string>;
  weather?: WeatherPoint;
}

/** Ranked complete outfits (all required parts present), or a best-effort partial one with `missing`. */
export function rankOutfits(inp: RankInput): { ranked: { items: Item[]; score: number }[]; missing: MissingPart[]; partial: Item[] } {
  const band = (inp.weather ?? NO_WEATHER).band;
  const pool = inp.items.filter((i) => eligible(i, inp.occasion));
  const by = (p: Part) => pool.filter((i) => i.part === p).sort((a, b) => a.id.localeCompare(b.id));
  const tops = by('top');
  const bottoms = by('bottom');
  const dresses = inp.occasion === 'workout' ? [] : by('full');
  const shoes = by('shoes');

  const patterns: { parts: Part[]; lists: Item[][] }[] = [
    { parts: ['top', 'bottom', 'shoes'], lists: [tops, bottoms, shoes] },
  ];
  if (inp.occasion !== 'workout') patterns.push({ parts: ['full', 'shoes'], lists: [dresses, shoes] });

  // Scores are averaged per item / per colour pair so 2-piece (dress) and 3-piece outfits compete fairly.
  const score = (items: Item[]) => {
    const pairs = (items.length * (items.length - 1)) / 2;
    let s = pairs ? colorScore(items) / pairs : 0;
    for (const it of items) {
      let a = 0;
      if (it.favorite) a += 1;
      a -= Math.abs(it.dressiness - inp.dressiness) * 0.5; // prefer pieces close to the requested dressiness
      a += weatherOf(it).includes(band) ? 1.5 : -3; // weather ranks after occasion/dressiness filtering
      if (inp.usedToday?.has(it.id)) a -= 4;
      if (it.part === 'full' && (inp.occasion === 'evening' || inp.occasion === 'formal')) a += 1.5; // a dress is the natural going-out piece
      s += a / items.length;
    }
    s -= recencyPenalty(items, inp.history, inp.today) / items.length;
    return s;
  };

  const complete = patterns.flatMap((p) => (p.lists.every((l) => l.length > 0) ? combos(p.lists) : []));
  if (complete.length) {
    const ranked = complete
      .map((items) => ({ items, score: score(items) }))
      .sort((a, b) => b.score - a.score || a.items.map((i) => i.id).join().localeCompare(b.items.map((i) => i.id).join()));
    return { ranked, missing: [], partial: [] };
  }

  // Nothing complete: pick the pattern missing the fewest parts, show what we do have.
  let best = patterns[0];
  let bestMissing = best.parts.filter((_, i) => best.lists[i].length === 0).length;
  for (const p of patterns.slice(1)) {
    const m = p.parts.filter((_, i) => p.lists[i].length === 0).length;
    if (m < bestMissing) { best = p; bestMissing = m; }
  }
  const missing = best.parts.filter((_, i) => best.lists[i].length === 0);
  const partial = best.lists.filter((l) => l.length > 0).map((l) => l.map((i) => ({ i, s: score([i]) })).sort((a, b) => b.s - a.s)[0].i);
  return { ranked: [], missing, partial };
}

/** How much of a layer does this weather/occasion call for? */
export function layerNeed(occasion: Occasion, w: WeatherPoint, hour: number): 'none' | 'optional' | 'required' {
  if (w.band === 'cold') return occasion === 'workout' ? 'optional' : 'required';
  if (w.band === 'mild' && w.temp <= 19 && hour >= 18) return 'optional'; // cool evening
  return 'none';
}

function pickLayer(inp: RankInput, outfit: Item[], need: 'optional' | 'required'): Item | undefined {
  const band = (inp.weather ?? NO_WEATHER).band;
  const cands = inp.items
    .filter((i) => layerEligible(i, inp.occasion))
    .filter((i) => weatherOf(i).includes(band) || (band === 'mild' && weatherOf(i).includes('cold') && need === 'optional'));
  if (!cands.length) return undefined;
  return cands
    .map((i) => ({ i, s: colorScore([...outfit, i]) + (i.favorite ? 1 : 0) - (inp.usedToday?.has(i.id) ? 4 : 0) }))
    .sort((a, b) => b.s - a.s || a.i.id.localeCompare(b.i.id))[0].i;
}

const firstWord = (i: Item) => (i.subtype ?? i.name).split(' ')[0];
const withArticle = (w: string) => `ה${w}`;

export function reasonFor(occasion: Occasion, event: CalEvent | null, o: { items: Item[]; layer?: Item; need: 'none' | 'optional' | 'required'; weather: WeatherPoint }): string {
  const hour = event ? new Date(event.start).getHours() : 12;
  const dress = o.items.find((i) => i.part === 'full');
  const w = o.weather;
  const when = hour >= 17 ? 'ערב' : 'יום';
  let base: string;
  if (!event) base = 'לוק קליל ליום חופשי';
  else
    switch (occasion) {
      case 'work':
        base = hour < 12 ? 'לוק מסודר לפגישת בוקר' : hour < 17 ? 'לוק מסודר לפגישה אחר הצהריים' : 'לוק מסודר לפגישת ערב';
        break;
      case 'workout':
        base = o.items.length ? `לבוש נוח ל${event.title}` : 'לבוש נוח לאימון';
        break;
      case 'evening':
        base = dress ? 'השמלה מתאימה לבילוי' : 'לוק אלגנטי לבילוי';
        break;
      case 'formal':
        base = dress ? 'השמלה מתאימה לאירוע חגיגי' : 'לוק מוקפד לאירוע חגיגי';
        break;
      default:
        base = 'לוק קליל ויומיומי';
    }
  const parts = [base];
  if (o.layer && o.need === 'required') parts.push(`${withArticle(firstWord(o.layer))} מוסיף שכבה ל${when === 'ערב' ? 'ערב' : 'יום'} ${w.band === 'cold' ? 'קר' : 'קריר'}`);
  else if (o.layer && o.need === 'optional') parts.push(w.band === 'cold' ? `אפשר להוסיף ${withArticle(firstWord(o.layer))} לדרך` : `${withArticle(firstWord(o.layer))} יעזור ב${when === 'ערב' ? 'ערב קריר' : 'יום קריר'}`);
  else if (o.need === 'none' && w.band === 'hot') parts.push(`ובחירה קלילה ל${when} חם`);
  return parts.join(parts.length > 1 && o.layer ? ', ו' : ' ');
}

export function buildOutfit(inp: RankInput, variant: number, event: CalEvent | null): Outfit {
  const weather = inp.weather ?? NO_WEATHER;
  const hour = event ? new Date(event.start).getHours() : 12;
  const need = layerNeed(inp.occasion, weather, hour);
  const { ranked, missing, partial } = rankOutfits(inp);

  let items: Item[];
  let options: number;
  if (ranked.length === 0) { items = partial; options = 0; }
  else {
    const pick = ranked[((variant % ranked.length) + ranked.length) % ranked.length];
    items = pick.items; options = ranked.length;
  }
  const layer = need === 'none' || ranked.length === 0 ? undefined : pickLayer(inp, items, need);
  const missingLayer = need === 'required' && ranked.length > 0 && !layer;
  const reason = reasonFor(inp.occasion, event, { items, layer, need, weather });
  return { items, missing: ranked.length ? [] : missing, options, reason, layer, layerNeed: need, missingLayer, weather };
}

export interface PlanContext {
  data: ModeData;
  today: string;
  weather?: (ms: number) => WeatherPoint;
}

export const entryKeyFor = (e: CalEvent | null): string => (e ? e.id : 'free');
export const choiceKey = (dKey: string, entryKey: string): string => `${dKey}|${entryKey}`;

/** Build the plan for one day from its (already moved/filtered) events. */
export function planDay(dKey: string, events: CalEvent[], ctx: PlanContext): DayPlan {
  const { data, today } = ctx;
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const used = new Set<string>();
  const entries: PlanEntry[] = [];
  const sources: (CalEvent | null)[] = sorted.length ? sorted : [null];

  for (const event of sources) {
    const key = entryKeyFor(event);
    let occasion: Occasion = 'casual';
    let dressiness: 1 | 2 | 3 = 1;
    let confident = true;
    if (event) {
      const override = data.occasionOverrides[event.id];
      if (override) { occasion = override; dressiness = defaultDressiness[override]; }
      else if (event.occasion) { occasion = event.occasion; dressiness = defaultDressiness[event.occasion]; }
      else { const c = classifyTitle(event.title); occasion = c.occasion; dressiness = c.dressiness; confident = c.confident; }
    }
    const at = event ? event.start : new Date(`${dKey}T12:00:00`).getTime();
    const weather = ctx.weather ? ctx.weather(at) : NO_WEATHER;
    const choice: Choice | undefined = data.choices[choiceKey(dKey, key)];
    const input: RankInput = { items: data.items, occasion, dressiness, history: data.history, today, usedToday: used, weather };

    let outfit: Outfit;
    let saved = false;
    if (choice?.savedItemIds?.length) {
      const found = choice.savedItemIds.map((id) => data.items.find((i) => i.id === id));
      const gone = choice.savedItemIds.filter((id, idx) => !found[idx] || !found[idx]!.available);
      const names = gone.map((id) => data.items.find((i) => i.id === id)?.name ?? 'פריט שנמחק');
      const items = found.filter((i): i is Item => !!i);
      const layer = items.find((i) => i.category === 'outerwear');
      const main = items.filter((i) => i !== layer);
      const need = layerNeed(occasion, weather, event ? new Date(event.start).getHours() : 12);
      outfit = {
        items: main, layer, layerNeed: need, weather, missing: [], options: 1,
        reason: reasonFor(occasion, event, { items: main, layer, need, weather }),
        stale: gone.length ? names : undefined,
      };
      saved = true;
    } else {
      outfit = buildOutfit(input, choice?.variant ?? 0, event);
    }
    outfit.items.forEach((i) => used.add(i.id));
    if (outfit.layer) used.add(outfit.layer.id);
    entries.push({ key, event, occasion, dressiness, confident, outfit, saved, worn: !!choice?.worn, weather });
  }
  return { dateKey: dKey, entries };
}
