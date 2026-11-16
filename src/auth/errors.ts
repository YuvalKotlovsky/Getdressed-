export interface AuthFail {
  text: string;
  /** seconds to wait before the same request can succeed (from a per-user cooldown), when the server said so */
  retryAfterSec?: number;
  kind: 'cooldown' | 'email-quota' | 'request-rate' | 'other';
}

/**
 * Supabase Auth failure -> Hebrew text. Never leaks raw server text to the UI.
 * The three rate limits are different things and need different advice:
 *  - cooldown      : code over_email_send_rate_limit, message "...only request this after N seconds" (per user/address)
 *  - email-quota   : code over_email_send_rate_limit, message "email rate limit exceeded" (whole project, built-in SMTP)
 *  - request-rate  : code over_request_rate_limit (too many requests from this network)
 */
export function describeAuthError(err: { code?: string; message?: string; status?: number } | string): AuthFail {
  const code = (typeof err === 'string' ? err : err.code ?? '').toLowerCase();
  const msg = (typeof err === 'string' ? err : err.message ?? '').toLowerCase();
  const c = `${code} ${msg}`;
  const other = (text: string): AuthFail => ({ text, kind: 'other' });
  if (c.includes('invalid_credentials') || c.includes('invalid login')) return other('האימייל או הסיסמה שגויים.');
  if (c.includes('email_not_confirmed')) return other('צריך לאמת את כתובת האימייל לפני הכניסה.');
  if (c.includes('weak_password') || c.includes('password should')) return other('הסיסמה חלשה מדי. השתמשו ב-8 תווים לפחות.');
  if (c.includes('user_already_exists') || c.includes('already registered')) return other('כתובת האימייל כבר רשומה. נסו להתחבר.');
  if (c.includes('over_email_send_rate_limit') || c.includes('only request this after') || c.includes('email rate limit')) {
    const m = /after (\d+) second/.exec(msg);
    if (m || c.includes('only request this after')) {
      const sec = m ? Math.max(1, Number(m[1])) : 60;
      return { kind: 'cooldown', retryAfterSec: sec, text: `בקשה לשליחת מייל כבר נשלחה לכתובת הזו. אפשר לבקש שוב בעוד ${sec === 1 ? 'שנייה אחת' : `${sec} שניות`}.` };
    }
    return { kind: 'email-quota', text: 'מכסת שליחת המיילים של השירות התמלאה לשעה הקרובה (לא קשור לכתובת שלכם). נסו שוב מאוחר יותר.' };
  }
  if (c.includes('over_request_rate_limit') || c.includes('request rate limit') || c.includes('rate limit') || err_status(err) === 429) {
    return { kind: 'request-rate', retryAfterSec: 60, text: 'יותר מדי בקשות מהרשת הזו. המתינו דקה ונסו שוב.' };
  }
  if (c.includes('email_address_invalid') || c.includes('validation_failed') || (c.includes('invalid') && c.includes('email'))) return other('כתובת האימייל לא תקינה.');
  if (c.includes('fetch') || c.includes('network')) return other('אין חיבור לשרת. בדקו את החיבור ונסו שוב.');
  if (c === ' unconfigured' || c.trim() === 'unconfigured') return other('הגרסה הזו לא מחוברת לשירות החשבונות.');
  return other('משהו השתבש. נסו שוב.');
}
function err_status(e: unknown): number | undefined { return typeof e === 'object' && e ? (e as { status?: number }).status : undefined; }

/** Text only (kept for callers that do not need the structure). */
export function authErrorHe(codeOrMessage: string): string { return describeAuthError(codeOrMessage).text; }
