import { COLORS } from '../theme';
import { occasionLabel } from '../i18n';
import { classifyTitle, defaultDressiness } from './classify';
import { dateKey, daysDiff, formatTime } from './dates';
import type {
  CalEvent, Choice, DayPlan, HistoryEntry, Item, MissingPart, ModeData, Occasion, Outfit, Part, PlanEntry,
} from '../types';

/** Dressiness window accepted for an occasion. */
const WINDOW: Record<Occasion, [number, number]> = {
  work: [2, 3],
  evening: [2, 3],
  casual: [1, 2],
  workout: [1, 3],
};

export function eligible(item: Item, occasion: Occasion): boolean {
  if (!item.available) return false;
  const isActive = item.category === 'activewear';
  if (occasion === 'workout') {
    // workout: activewear for top/bottom; any shoes tagged for workout
    if (item.part === 'shoes') return item.occasions.includes('workout');
    return isActive;
  }
  if (isActive) return false;
  if (!item.occasions.includes(occasion)) return false;
  const [lo, hi] = WINDOW[occasion];
  return item.dressiness >= lo && item.dressiness <= hi;
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
}

/** Ranked complete outfits (all required parts present), or a best-effort partial one with `missing`. */
export function rankOutfits(inp: RankInput): { ranked: { items: Item[]; score: number }[]; missing: MissingPart[]; partial: Item[] } {
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

  const score = (items: Item[]) => {
    let s = colorScore(items);
    for (const it of items) {
      if (it.favorite) s += 1;
      // prefer pieces close to the requested dressiness
      s -= Math.abs(it.dressiness - inp.dressiness) * 0.5;
      if (inp.usedToday?.has(it.id)) s -= 4;
    }
    s -= recencyPenalty(items, inp.history, inp.today);
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

export function reasonFor(occasion: Occasion, event: CalEvent | null, dressiness: number): string {
  if (!event) return 'לוק קליל ליום חופשי';
  const h = new Date(event.start).getHours();
  switch (occasion) {
    case 'work':
      return h < 12 ? 'לוק מסודר לפגישת בוקר' : h < 17 ? 'לוק מסודר לפגישה אחר הצהריים' : 'לוק מסודר לפגישת ערב';
    case 'workout':
      return h < 12 ? 'לבוש נוח לאימון בוקר' : 'לבוש נוח לאימון ערב';
    case 'evening':
      return 'לוק אלגנטי לערב';
    default:
      return dressiness >= 2 ? 'לוק קז׳ואל מסודר' : 'לוק קליל ויומיומי';
  }
}

export function buildOutfit(inp: RankInput, variant: number, event: CalEvent | null): Outfit {
  const { ranked, missing, partial } = rankOutfits(inp);
  const reason = reasonFor(inp.occasion, event, inp.dressiness);
  if (ranked.length === 0) {
    return { items: partial, missing, options: 0, reason };
  }
  const pick = ranked[((variant % ranked.length) + ranked.length) % ranked.length];
  return { items: pick.items, missing: [], options: ranked.length, reason };
}

export interface PlanContext {
  data: ModeData;
  today: string;
}

export function entryKeyFor(e: CalEvent | null): string {
  return e ? e.id : 'free';
}

export function choiceKey(dKey: string, entryKey: string): string {
  return `${dKey}|${entryKey}`;
}

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
      if (override) {
        occasion = override;
        dressiness = defaultDressiness[override];
      } else if (event.occasion) {
        occasion = event.occasion;
        dressiness = defaultDressiness[event.occasion];
      } else {
        const c = classifyTitle(event.title);
        occasion = c.occasion; dressiness = c.dressiness; confident = c.confident;
      }
    }
    const choice: Choice | undefined = data.choices[choiceKey(dKey, key)];
    const input: RankInput = { items: data.items, occasion, dressiness, history: data.history, today, usedToday: used };

    let outfit: Outfit;
    let saved = false;
    if (choice?.savedItemIds?.length) {
      const items = choice.savedItemIds.map((id) => data.items.find((i) => i.id === id));
      const gone = choice.savedItemIds.filter((id, idx) => !items[idx] || !items[idx]!.available);
      const names = gone.map((id) => data.items.find((i) => i.id === id)?.name ?? 'פריט שנמחק');
      outfit = {
        items: items.filter((i): i is Item => !!i),
        missing: [],
        options: 1,
        reason: reasonFor(occasion, event, dressiness),
        stale: gone.length ? names : undefined,
      };
      saved = true;
    } else {
      outfit = buildOutfit(input, choice?.variant ?? 0, event);
    }
    outfit.items.forEach((i) => used.add(i.id));
    entries.push({ key, event, occasion, dressiness, confident, outfit, saved, worn: !!choice?.worn });
  }
  return { dateKey: dKey, entries };
}

export function eventTimeLabel(e: CalEvent): string {
  return formatTime(e.start);
}

export { occasionLabel, dateKey };
