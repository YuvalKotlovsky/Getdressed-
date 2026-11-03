import type { Category, Dressiness, Item, Occasion, Part } from '../types';
import { partForCategory, type TagSuggestion } from './schema';

export type { TagSuggestion } from './schema';

/**
 * Photo tagging seam. Manual tagging is always available (no suggestions).
 * RecognitionTagger (./recognition.ts) is optional: it needs a configured server and the user's consent per photo.
 */
export interface Tagger {
  readonly id: 'manual' | 'recognition';
  suggest(photo: { base64: string; mediaType: string }): Promise<TagSuggestion>;
}

export const manualTagger: Tagger = { id: 'manual', suggest: async () => ({}) };

export const defaultsFor = (category: Category): Pick<Item, 'part' | 'dressiness' | 'occasions'> => {
  const part: Part = partForCategory(category);
  const base: Record<Category, { dressiness: Dressiness; occasions: Occasion[] }> = {
    top: { dressiness: 2, occasions: ['casual', 'work'] },
    bottom: { dressiness: 2, occasions: ['casual', 'work'] },
    dress: { dressiness: 2, occasions: ['casual', 'evening'] },
    shoes: { dressiness: 2, occasions: ['casual', 'work'] },
    activewear: { dressiness: 1, occasions: ['workout'] },
    outerwear: { dressiness: 2, occasions: ['casual', 'work'] },
  };
  return { part, ...base[category] };
};
