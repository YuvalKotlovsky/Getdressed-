/**
 * Server-side verification of the caller's Supabase session. The access token is checked by Supabase Auth itself
 * (`GET /auth/v1/user`: signature, expiry, revoked sessions), so no JWT secret lives here. The user id is taken ONLY
 * from that response, never from the request body. Unverified emails are refused.
 */
export interface Verified { userId: string; token: string }
export type AuthResult = { ok: true; user: Verified } | { ok: false; status: 401 | 403 | 503; error: 'unauthorized' | 'email_not_verified' | 'auth_unavailable' };

export interface SupabaseServerEnv { url: string; anonKey: string; fetchImpl?: typeof fetch }

export async function verifySession(authorization: string | undefined, env: SupabaseServerEnv): Promise<AuthResult> {
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(authorization ?? '');
  if (!m) return { ok: false, status: 401, error: 'unauthorized' };
  const token = m[1];
  let res: Response;
  try {
    res = await (env.fetchImpl ?? fetch)(`${env.url.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: env.anonKey },
      signal: AbortSignal.timeout(8000),
    });
  } catch { return { ok: false, status: 503, error: 'auth_unavailable' }; }
  if (res.status === 401 || res.status === 403) return { ok: false, status: 401, error: 'unauthorized' };
  if (!res.ok) return { ok: false, status: 503, error: 'auth_unavailable' };
  const u: any = await res.json().catch(() => null);
  if (!u || typeof u.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(u.id)) return { ok: false, status: 401, error: 'unauthorized' };
  if (!u.email_confirmed_at) return { ok: false, status: 403, error: 'email_not_verified' };
  return { ok: true, user: { userId: u.id, token } };
}
