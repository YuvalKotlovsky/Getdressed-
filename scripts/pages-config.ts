import { parseCloudConfig } from '../src/cloud/config';

/** Project ref of `wearmyweek-dev` (public identifier, not a secret): a published web build must never point at it. */
const DEV_PROJECT_REF = 'lenqqdflencoxgpcdlrg';

/** Configuration safeguard for the web build (not a substitute for authorization). Returns an error message or null. Never echoes values. */
export function validatePagesConfig(target: string, appEnv?: string, url?: string, key?: string): string | null {
  if (!appEnv) return 'APP_ENV is not set on the GitHub Environment.';
  if (appEnv !== target) return `APP_ENV does not equal the selected environment '${target}'.`;
  const c = parseCloudConfig(url, key);
  if (!c.ok) return c.reason === 'secret-key' ? 'SUPABASE_ANON_KEY is a secret/service-role key. Use the public anon/publishable key.' : `SUPABASE_URL / SUPABASE_ANON_KEY invalid (${c.reason}).`;
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(c.url)) return 'SUPABASE_URL must look like https://<project-ref>.supabase.co.';
  if (c.url.includes(DEV_PROJECT_REF)) return 'SUPABASE_URL points at the development project; a published web build must never use it.';
  const k = c.anonKey;
  if (k.startsWith('eyJ')) {
    let role: string | undefined;
    try { role = JSON.parse(Buffer.from(k.split('.')[1] ?? '', 'base64url').toString('utf8')).role; } catch { /* unreadable */ }
    if (role !== 'anon') return 'SUPABASE_ANON_KEY is a JWT whose role is not "anon".';
  } else if (!k.startsWith('sb_publishable_')) {
    return 'SUPABASE_ANON_KEY must be a legacy anon JWT or an sb_publishable_ key.';
  }
  return null;
}

if (process.argv[1]?.endsWith('pages-config.ts')) {
  const err = validatePagesConfig(process.env.TARGET ?? '', process.env.APP_ENV, process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  if (err) { console.error(`::error title=Invalid '${process.env.TARGET}' environment configuration::${err}`); process.exit(1); }
  console.log(`Environment '${process.env.TARGET}' configuration is valid.`);
}
