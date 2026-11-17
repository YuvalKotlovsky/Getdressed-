/** Durable per-user quota. The database is the source of truth: consume_ai_quota(kind) reads FIXED limits from ai_quota_limits (migrations 20261116000000 + 20261116000100); the caller cannot choose them. */
export type QuotaResult = { allowed: true; used: number; limit: number } | { allowed: false; scope: 'day' | 'month' | 'global'; used: number; limit: number } | { allowed: 'error' };
export interface QuotaStore { consume(user: { userId: string; token: string }, kind: 'analyze_photo'): Promise<QuotaResult> }

/** Calls the RPC as the caller (their JWT: auth.uid() says whose quota) AND with the server-only key (proves the call comes from this backend). */
export function supabaseQuota(env: { url: string; anonKey: string; serverKey: string; fetchImpl?: typeof fetch }): QuotaStore {
  return {
    async consume(user, kind) {
      try {
        const res = await (env.fetchImpl ?? fetch)(`${env.url.replace(/\/+$/, '')}/rest/v1/rpc/consume_ai_quota`, {
          method: 'POST',
          headers: { authorization: `Bearer ${user.token}`, apikey: env.anonKey, 'content-type': 'application/json', 'x-ai-server-key': env.serverKey }, // server-only secret: the database refuses the RPC without it
          body: JSON.stringify({ p_kind: kind }),
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return { allowed: 'error' };
        const j: any = await res.json();
        if (j?.allowed === true) return { allowed: true, used: Number(j.used), limit: Number(j.limit) };
        if (j?.allowed === false && ['day', 'month', 'global'].includes(j.scope)) return { allowed: false, scope: j.scope, used: Number(j.used), limit: Number(j.limit) };
        return { allowed: 'error' };
      } catch { return { allowed: 'error' }; }
    },
  };
}
