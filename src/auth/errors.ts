/** Supabase auth error code (or message) -> Hebrew text. Never leaks raw server text to the UI. */
export function authErrorHe(codeOrMessage: string): string {
  const c = codeOrMessage.toLowerCase();
  if (c.includes('invalid_credentials') || c.includes('invalid login')) return 'האימייל או הסיסמה שגויים.';
  if (c.includes('email_not_confirmed')) return 'צריך לאמת את כתובת האימייל לפני הכניסה.';
  if (c.includes('weak_password') || c.includes('password should')) return 'הסיסמה חלשה מדי. השתמשו ב-8 תווים לפחות.';
  if (c.includes('user_already_exists') || c.includes('already registered')) return 'כתובת האימייל כבר רשומה. נסו להתחבר.';
  if (c.includes('over_request_rate_limit') || c.includes('over_email_send_rate_limit') || c.includes('rate limit')) return 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות.';
  if (c.includes('validation_failed') || c.includes('invalid') && c.includes('email')) return 'כתובת האימייל לא תקינה.';
  if (c.includes('fetch') || c.includes('network')) return 'אין חיבור לשרת. בדקו את החיבור ונסו שוב.';
  if (c === 'unconfigured') return 'הגרסה הזו לא מחוברת לשירות החשבונות.';
  return 'משהו השתבש. נסו שוב.';
}
