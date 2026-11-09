import type { ModeData } from '../types';

/** A new account always starts here: no items, no history, no events. */
export const emptyModeData = (): ModeData => ({
  items: [], choices: {}, history: [], occasionOverrides: {}, manualEvents: [], eventMoves: {},
});
