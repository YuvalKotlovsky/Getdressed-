import type { Tagger, TagSuggestion } from './tagger';
import { sanitizeSuggestion } from './schema';

/** Set at build time, e.g. EXPO_PUBLIC_RECOGNITION_URL=https://my-server.example.com. Contains no secrets. */
export const RECOGNITION_URL: string | undefined = process.env.EXPO_PUBLIC_RECOGNITION_URL || undefined;

export class RecognitionError extends Error {
  constructor(public kind: 'not_garment' | 'network' | 'server' | 'not_configured') { super(kind); }
}

export function createRecognitionTagger(baseUrl: string | undefined = RECOGNITION_URL, fetchImpl: typeof fetch = fetch, timeoutMs = 25000): Tagger {
  return {
    id: 'recognition',
    async suggest(photo): Promise<TagSuggestion> {
      if (!baseUrl) throw new RecognitionError('not_configured');
      let res: Response;
      try {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: photo.base64, mediaType: photo.mediaType }),
          signal: ctl?.signal,
        });
        if (timer) clearTimeout(timer);
      } catch {
        throw new RecognitionError('network');
      }
      let body: any = null;
      try { body = await res.json(); } catch {}
      if (!res.ok) throw new RecognitionError(body?.error === 'not_garment' ? 'not_garment' : 'server');
      const s = sanitizeSuggestion(body?.suggestion);
      if (!s) throw new RecognitionError('server');
      return s;
    },
  };
}
