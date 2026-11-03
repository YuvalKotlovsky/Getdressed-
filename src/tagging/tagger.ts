import type { Category, Dressiness, Item, Occasion, Part } from '../types';

export interface TagSuggestion {
  category?: Category;
  part?: Part;
  color?: string;
  dressiness?: Dressiness;
  occasions?: Occasion[];
}

/**
 * Photo tagging seam. Manual tagging is the baseline (no suggestions).
 * Next milestone: a RecognitionTagger that asks consent, sends the chosen photo to a
 * server-side endpoint (keys stay on the server) and returns suggestions for the user to confirm.
 */
export interface Tagger {
  readonly id: 'manual' | 'recognition';
  suggest(photoUri: string): Promise<TagSuggestion>;
}

export const manualTagger: Tagger = { id: 'manual', suggest: async () => ({}) };

export const defaultsFor = (category: Category): Pick<Item, 'part' | 'dressiness' | 'occasions'> => {
  switch (category) {
    case 'top': return { part: 'top', dressiness: 2, occasions: ['casual', 'work'] };
    case 'bottom': return { part: 'bottom', dressiness: 2, occasions: ['casual', 'work'] };
    case 'dress': return { part: 'full', dressiness: 2, occasions: ['casual', 'evening'] };
    case 'shoes': return { part: 'shoes', dressiness: 2, occasions: ['casual', 'work'] };
    case 'activewear': return { part: 'top', dressiness: 1, occasions: ['workout'] };
  }
};
