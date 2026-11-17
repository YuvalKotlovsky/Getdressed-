import type { Tagger, TagSuggestion } from './tagger';
import { sanitizeSuggestion } from './schema';

/** Set at build time, e.g. EXPO_PUBLIC_RECOGNITION_URL=https://my-server.example.com. Contains no secrets. */
export const RECOGNITION_URL: string | undefined = process.env.EXPO_PUBLIC_RECOGNITION_URL || undefined;

export class RecognitionError extends Error {
  constructor(public kind: 'not_garment' | 'network' | 'server' | 'not_configured' | 'unauthorized' | 'unverified' | 'quota' | 'quota_global' | 'too_large' | 'busy') { super(kind); }
}

/** `getToken` returns the signed-in user's Supabase access token (null when signed out). The server verifies it; nothing here is trusted. */
export function createRecognitionTagger(baseUrl: string | undefined = RECOGNITION_URL, fetchImpl: typeof fetch = fetch, timeoutMs = 25000, getToken?: () => Promise<string | null>): Tagger {
  return {
    id: 'recognition',
    async suggest(photo): Promise<TagSuggestion> {
      if (!baseUrl) throw new RecognitionError('not_configured');
      let token: string | null = null;
      // the session token is only ever sent over HTTPS (or to a local dev server)
      if (getToken && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseUrl)) throw new RecognitionError('not_configured');
      if (getToken) { token = await getToken().catch(() => null); if (!token) throw new RecognitionError('unauthorized'); }
      let res: Response;
      try {
        const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
        res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/v1/analyze-photo`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ image: photo.base64, mediaType: photo.mediaType }),
          signal: ctl?.signal,
        });
        if (timer) clearTimeout(timer);
      } catch {
        throw new RecognitionError('network');
      }
      let body: any = null;
      try { body = await res.json(); } catch {}
      if (!res.ok) {
        const e = body?.error;
        throw new RecognitionError(e === 'not_garment' ? 'not_garment' : e === 'email_not_verified' ? 'unverified' : res.status === 401 ? 'unauthorized' : e === 'quota_exceeded' ? (body?.scope === 'global' ? 'quota_global' : 'quota') : res.status === 413 ? 'too_large' : e === 'busy' ? 'busy' : 'server');
      }
      const s = sanitizeSuggestion(body?.suggestion);
      if (!s) throw new RecognitionError('server');
      return s;
    },
  };
}

export type RecognitionStatus = 'unconfigured' | 'checking' | 'ready' | 'nokey' | 'down';

/** Cheap health ping so the editor can say WHY recognition is unavailable (deployed build without URL, server down, no key). */
export async function checkRecognitionServer(baseUrl: string | undefined = RECOGNITION_URL, fetchImpl: typeof fetch = fetch): Promise<RecognitionStatus> {
  if (!baseUrl) return 'unconfigured';
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    const res = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/health`, { signal: ctl?.signal });
    if (timer) clearTimeout(timer);
    if (!res.ok) return 'down';
    const j: any = await res.json().catch(() => null);
    return j?.ok ? (j.recognition === false ? 'nokey' : 'ready') : 'down';
  } catch {
    return 'down';
  }
}
