/**
 * What the email-confirmation link brought back to the page (web). Supabase redirects to the app with either
 *   #access_token=...&refresh_token=...&type=signup            (success: supabase-js turns it into a session)
 *   #error=access_denied&error_code=otp_expired&error_description=...   (expired / already used / invalid)
 * (some versions use ?query instead of #fragment). Never returns the tokens themselves.
 */
/** Remove a leftover token fragment from the address bar/history (called once the session attempt has settled). */
export function scrubAuthUrl(): void {
  try {
    const w = (globalThis as { location?: Location; history?: History }).location;
    if (w && /access_token|refresh_token/.test(`${w.hash}${w.search}`)) (globalThis as { history?: History }).history?.replaceState(null, '', w.pathname);
  } catch { /* not a browser */ }
}

export type AuthCallback =
  | { kind: 'none' }
  | { kind: 'session' }
  | { kind: 'error'; reason: 'expired' | 'invalid' };

export function parseAuthCallback(hash: string, search = ''): AuthCallback {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const q = new URLSearchParams(search.replace(/^\?/, ''));
  const get = (k: string) => p.get(k) ?? q.get(k);
  if (get('error') || get('error_code')) {
    const code = (get('error_code') ?? '').toLowerCase();
    return { kind: 'error', reason: code === 'otp_expired' ? 'expired' : 'invalid' };
  }
  if (get('access_token') && get('refresh_token')) return { kind: 'session' };
  return { kind: 'none' };
}

let cached: AuthCallback | null = null;
/** Read ONCE at startup, before supabase-js consumes and removes the fragment. */
export function readAuthCallbackOnce(): AuthCallback {
  if (cached) return cached;
  cached = { kind: 'none' };
  try {
    const w = (globalThis as { location?: Location; history?: History }).location;
    if (w) {
      cached = parseAuthCallback(w.hash ?? '', w.search ?? '');
      if (cached.kind === 'error') (globalThis as { history?: History }).history?.replaceState(null, '', w.pathname);
    }
  } catch { /* not a browser */ }
  return cached;
}

/** Where the confirmation link should send the browser: this page's own origin + path (web only). */
export function emailRedirectUrl(): string | undefined {
  try {
    const w = (globalThis as { location?: Location }).location;
    if (!w || !/^https?:$/.test(w.protocol)) return undefined;
    return `${w.origin}${w.pathname.endsWith('/') ? w.pathname : `${w.pathname}/`}`;
  } catch { return undefined; }
}
