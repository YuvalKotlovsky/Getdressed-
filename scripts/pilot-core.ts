/** The pilot's spending guard, kept separate so it can be unit-tested without any network or key. */
import type { Provider, ProviderResult } from '../server/gemini';

export const HARD_MAX_CALLS = 8;
export interface CallCounter { read(): number; write(n: number): void }

/** Wraps a provider so that AT MOST `maxCalls` outbound calls can ever happen across runs (the counter is persisted by the caller).
 *  The counter is incremented BEFORE the call, so a failed or timed-out call still counts; there is no retry anywhere. */
export function cappedProvider(base: Provider, maxCalls: number, counter: CallCounter, onResult?: (r: ProviderResult | undefined) => void): Provider {
  const cap = Math.min(HARD_MAX_CALLS, Math.max(1, Math.floor(maxCalls)));
  return {
    async analyze(img, prompt) {
      const used = counter.read();
      if (used >= cap) throw new Error('pilot call cap reached');
      counter.write(used + 1);
      try {
        const r = (await base.analyze(img, prompt)) as ProviderResult | string;
        const res = typeof r === 'string' ? { text: r } : r;
        onResult?.(res);
        return res;
      } catch (e) { onResult?.(undefined); throw e; }
    },
  };
}
