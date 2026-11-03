import type { Category, Dressiness, Occasion, Part } from './types';

export const categoryLabel: Record<Category, string> = {
  top: 'חולצות',
  bottom: 'תחתונים',
  dress: 'שמלות',
  shoes: 'נעליים',
  activewear: 'ספורט',
};
export const categoryEmoji: Record<Category, string> = {
  top: '👕',
  bottom: '👖',
  dress: '👗',
  shoes: '👟',
  activewear: '🩱',
};
export const partLabel: Record<Part, string> = {
  top: 'חלק עליון',
  bottom: 'חלק תחתון',
  full: 'שמלה',
  shoes: 'נעליים',
};
export const missingLabel: Record<Part, string> = {
  top: 'חולצה מתאימה',
  bottom: 'מכנסיים או חצאית מתאימים',
  full: 'שמלה מתאימה',
  shoes: 'נעליים מתאימות',
};
export const occasionLabel: Record<Occasion, string> = {
  work: 'עבודה / פגישה',
  workout: 'אימון',
  casual: 'יום יומי',
  evening: 'ערב / בילוי',
};
export const dressinessLabel: Record<Dressiness, string> = {
  1: 'קז׳ואל',
  2: 'מסודר',
  3: 'אלגנטי',
};
export const dayNames = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
