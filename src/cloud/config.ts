/** Client-safe Supabase configuration. Only the project URL and the public (anon/publishable) key belong in the app. */
export type CloudConfig = { ok: true; url: string; anonKey: string } | { ok: false; reason: 'missing' | 'secret-key' | 'bad-url' };

function jwtRole(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('utf8');
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch { return null; }
}

/** Refuses a service-role / secret key even if someone puts one in EXPO_PUBLIC_* by mistake. */
export function parseCloudConfig(url?: string, anonKey?: string): CloudConfig {
  const u = (url ?? '').trim();
  const k = (anonKey ?? '').trim();
  if (!u || !k) return { ok: false, reason: 'missing' };
  if (k.startsWith('sb_secret_') || jwtRole(k) === 'service_role') return { ok: false, reason: 'secret-key' };
  let parsed: URL;
  try { parsed = new URL(u); } catch { return { ok: false, reason: 'bad-url' }; }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return { ok: false, reason: 'bad-url' };
  return { ok: true, url: u.replace(/\/+$/, ''), anonKey: k };
}

export const cloudConfig = (): CloudConfig =>
  parseCloudConfig(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
