import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '../cloud/client';
import { cloudConfig } from '../cloud/config';
import { authErrorHe } from './errors';

/**
 * unconfigured  - this build has no Supabase URL/key (the app cannot be used)
 * signedOut     - show sign-in / registration
 * needsVerification - registered but the email is not confirmed yet (no wardrobe access)
 * signedIn      - verified account
 */
export type AuthStatus = 'loading' | 'unconfigured' | 'signedOut' | 'needsVerification' | 'signedIn';

interface AuthCtx {
  status: AuthStatus;
  user: User | null;
  /** email waiting for verification */
  pendingEmail: string | null;
  signUp(email: string, password: string): Promise<string | null>;
  signIn(email: string, password: string): Promise<string | null>;
  resendVerification(): Promise<string | null>;
  signOut(): Promise<void>;
  backToSignIn(): void;
}

const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('AuthProvider missing');
  return c;
};

const verified = (u: User | null | undefined) => !!u?.email_confirmed_at;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sb = useMemo(() => getSupabase(), []);
  const [status, setStatus] = useState<AuthStatus>(cloudConfig().ok ? 'loading' : 'unconfigured');
  const [user, setUser] = useState<User | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const apply = useCallback((u: User | null | undefined) => {
    if (u && verified(u)) { setUser(u); setStatus('signedIn'); return; }
    setUser(null);
    if (u?.email) { setPendingEmail(u.email); setStatus('needsVerification'); } else setStatus((s) => (s === 'needsVerification' ? s : 'signedOut'));
  }, []);

  useEffect(() => {
    if (!sb) return;
    let live = true;
    sb.auth.getSession().then(({ data }) => { if (live) apply(data.session?.user); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => { if (live) apply(session?.user); });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, [sb, apply]);

  const value: AuthCtx = {
    status, user, pendingEmail,
    async signUp(email, password) {
      if (!sb) return authErrorHe('unconfigured');
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
      if (error) return authErrorHe(error.code ?? error.message);
      // With "Confirm email" on there is no session until the link is opened. If a session exists but is unverified, drop it.
      if (data.session && !verified(data.session.user)) await sb.auth.signOut();
      if (!data.session) { setPendingEmail(email.trim()); setStatus('needsVerification'); }
      return null;
    },
    async signIn(email, password) {
      if (!sb) return authErrorHe('unconfigured');
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (error.code === 'email_not_confirmed') { setPendingEmail(email.trim()); setStatus('needsVerification'); return null; }
        return authErrorHe(error.code ?? error.message);
      }
      if (!verified(data.user)) { await sb.auth.signOut(); setPendingEmail(email.trim()); setStatus('needsVerification'); }
      return null;
    },
    async resendVerification() {
      if (!sb || !pendingEmail) return authErrorHe('unconfigured');
      const { error } = await sb.auth.resend({ type: 'signup', email: pendingEmail });
      return error ? authErrorHe(error.code ?? error.message) : null;
    },
    async signOut() { if (sb) await sb.auth.signOut(); setUser(null); setPendingEmail(null); setStatus('signedOut'); },
    backToSignIn() { setPendingEmail(null); setStatus('signedOut'); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
