import type { Classification, Occasion } from '../types';

/** On-device keyword classifier for Hebrew and English event titles. */
const RULES: { occasion: Occasion; dressiness: 1 | 2 | 3; words: string[] }[] = [
  {
    occasion: 'workout',
    dressiness: 1,
    words: [
      'פילאטיס', 'פילטיס', 'יוגה', 'ריצה', 'אימון', 'חדר כושר', 'כושר', 'ספינינג', 'שחייה', 'כדורגל', 'טניס', 'הליכה',
      'pilates', 'yoga', 'gym', 'workout', 'run', 'running', 'training', 'spinning', 'swim', 'crossfit', 'hiit',
    ],
  },
  {
    occasion: 'work',
    dressiness: 2,
    words: [
      'פגישה', 'ישיבה', 'לקוח', 'ראיון', 'עבודה', 'סטנד', 'מצגת', 'הרצאה', 'צוות', 'סינק', 'ועדה',
      'meeting', 'client', 'interview', 'standup', 'stand-up', 'sync', 'presentation', 'work', 'review', '1:1', 'call',
    ],
  },
  {
    occasion: 'formal',
    dressiness: 3,
    words: ['חתונה', 'חינה', 'בר מצווה', 'בת מצווה', 'ברית', 'גאלה', 'אירוע חגיגי', 'wedding', 'gala', 'formal', 'ceremony', 'black tie'],
  },
  {
    occasion: 'evening',
    dressiness: 2,
    words: [
      'ארוחת ערב', 'מסיבה', 'דייט', 'יום הולדת', 'יומולדת', 'הצגה', 'קונצרט', 'בילוי', 'בר ', 'מסעדה',
      'dinner', 'wedding', 'party', 'date', 'birthday', 'concert', 'show', 'drinks', 'restaurant',
    ],
  },
  {
    occasion: 'casual',
    dressiness: 1,
    words: ['קפה', 'חברים', 'קניות', 'משפחה', 'סבתא', 'פיקניק', 'חוף', 'coffee', 'friends', 'shopping', 'family', 'brunch', 'lunch', 'ארוחת צהריים', 'בראנץ'],
  },
];

export function classifyTitle(title: string): Classification {
  const t = title.toLowerCase();
  for (const r of RULES) {
    if (r.words.some((w) => t.includes(w))) {
      return { occasion: r.occasion, dressiness: r.dressiness, confident: true };
    }
  }
  return { occasion: 'casual', dressiness: 1, confident: false };
}

export const defaultDressiness: Record<Occasion, 1 | 2 | 3> = { workout: 1, work: 2, evening: 2, casual: 1, formal: 3 };
