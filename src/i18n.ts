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
