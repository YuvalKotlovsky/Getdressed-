/** Durable per-user quota. The database (consume_ai_quota, migration 20261116000000) is the source of truth. */
export interface QuotaLimits { perDay: number; perMonth: number; globalPerDay: number }
export type QuotaResult = { allowed: true; used: number; limit: number } | { allowed: false; scope: 'day' | 'month' | 'global'; used: number; limit: number } | { allowed: 'error' };
export interface QuotaStore { consume(user: { userId: string; token: string }, kind: 'analyze_photo', limits: QuotaLimits): Promise<QuotaResult> }

export const DEFAULT_LIMITS: QuotaLimits = { perDay: 20, perMonth: 200, globalPerDay: 500 };

/** Calls the RPC as the caller (their JWT), so the function sees auth.uid() and the verified-email check. */
export function supabaseQuota(env: { url: string; anonKey: string; fetchImpl?: typeof fetch }): QuotaStore {
  return {
    async consume(user, kind, l) {
      try {
        const res = await (env.fetchImpl ?? fetch)(`${env.url.replace(/\/+$/, '')}/rest/v1/rpc/consume_ai_quota`, {
          method: 'POST',
          headers: { authorization: `Bearer ${user.token}`, apikey: env.anonKey, 'content-type': 'application/json' },
          body: JSON.stringify({ p_kind: kind, p_day_limit: l.perDay, p_month_limit: l.perMonth, p_global_day_limit: l.globalPerDay }),
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
