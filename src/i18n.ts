import type { Category, Dressiness, Occasion, Part, Weather } from './types';

export const categoryLabel: Record<Category, string> = {
  top: 'חולצות',
  bottom: 'תחתונים',
  dress: 'שמלות',
  shoes: 'נעליים',
  activewear: 'ספורט',
  outerwear: 'שכבות',
};
/** Subtle placeholder glyphs (MaterialCommunityIcons names) for demo items without photos. */
export const categoryIcon: Record<Category, string> = {
  top: 'tshirt-crew-outline',
  bottom: 'hanger',
  dress: 'human-female',
  shoes: 'shoe-sneaker',
  activewear: 'tshirt-v-outline',
  outerwear: 'coat-rack',
};
export const partLabel: Record<Part, string> = {
  top: 'חלק עליון',
  bottom: 'חלק תחתון',
  full: 'שמלה',
  shoes: 'נעליים',
  layer: 'שכבה',
};
export const missingLabel: Record<Part, string> = {
  top: 'חולצה מתאימה',
  bottom: 'מכנסיים או חצאית מתאימים',
  full: 'שמלה מתאימה',
  shoes: 'נעליים מתאימות',
  layer: 'שכבה חמה',
};
export const occasionLabel: Record<Occasion, string> = {
  work: 'עבודה / פגישה',
  workout: 'אימון',
  casual: 'יום־יום',
  evening: 'בילוי',
  formal: 'אירוע חגיגי',
};
export const weatherLabel: Record<Weather, string> = { hot: 'חם', mild: 'נעים', cold: 'קר' };
export const dressinessLabel: Record<Dressiness, string> = {
  1: 'קז׳ואל',
  2: 'מסודר',
  3: 'אלגנטי',
};
export const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** Quick subtype choices per category (free text is still allowed). */
export const SUBTYPES: Record<Category, string[]> = {
  top: ['חולצה', 'חולצה מכופתרת', 'טי שירט', 'סוודר', 'סווטשירט', 'גופייה'],
  bottom: ['ג׳ינס', 'מכנסי בד', 'חצאית', 'שורט'],
  dress: ['שמלה', 'שמלת מידי', 'שמלת מקסי', 'שמלה קצרה'],
  shoes: ['סניקרס', 'נעלי עור', 'נעלי עקב', 'בלרינות', 'מגפונים', 'מגפיים', 'סנדלים', 'כפכף', 'כפכף סגור / קלוג'],
  activewear: ['טייץ ספורט', 'גופיית ספורט', 'חולצת ספורט', 'מכנסי ספורט'],
  outerwear: ['ז׳קט', 'מעיל', 'בלייזר', 'קרדיגן', 'ג׳קט ספורט'],
};
