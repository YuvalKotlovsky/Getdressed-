import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { getSupabase } from '../cloud/client';
import { cloudConfig } from '../cloud/config';
import { describeAuthError, type AuthFail } from './errors';
import { emailRedirectUrl, readAuthCallbackOnce } from './callback';

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
  /** set when the user arrived through an email link that did not give them a session */
  linkNotice: 'expired' | 'verified-signin' | null;
  dismissLinkNotice(): void;
  signUp(email: string, password: string): Promise<AuthFail | null>;
  signIn(email: string, password: string): Promise<AuthFail | null>;
  /** resend the confirmation mail to `email` (defaults to the address waiting for verification) */
  resendVerification(email?: string): Promise<AuthFail | null>;
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
  const callback = useMemo(() => readAuthCallbackOnce(), []);
  const [linkNotice, setLinkNotice] = useState<'expired' | 'verified-signin' | null>(callback.kind === 'error' ? 'expired' : null);
  const unconfigured = { text: describeAuthError('unconfigured').text, kind: 'other' as const };

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

  // The link carried a session but the browser could not turn it into one: say so instead of leaving a blank sign-in.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (callback.kind !== 'session') return;
    const id = setTimeout(() => {
      if (statusRef.current === 'signedIn') return;
      setLinkNotice('verified-signin');
      setStatus((s) => (s === 'loading' || s === 'needsVerification' ? 'signedOut' : s));
    }, 8000);
    return () => clearTimeout(id);
  }, [callback]);
  useEffect(() => { if (status === 'signedIn') setLinkNotice(null); }, [status]);

  const value: AuthCtx = {
    status, user, pendingEmail, linkNotice, dismissLinkNotice: () => setLinkNotice(null),
    async signUp(email, password) {
      if (!sb) return unconfigured;
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: emailRedirectUrl() } });
      if (error) return describeAuthError(error);
      // With "Confirm email" on there is no session until the link is opened. If a session exists but is unverified, drop it.
      if (data.session && !verified(data.session.user)) await sb.auth.signOut();
      if (!data.session) { setPendingEmail(email.trim()); setStatus('needsVerification'); }
      return null;
    },
    async signIn(email, password) {
      if (!sb) return unconfigured;
      const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (error.code === 'email_not_confirmed') { setPendingEmail(email.trim()); setStatus('needsVerification'); return null; }
        return describeAuthError(error);
      }
      if (!verified(data.user)) { await sb.auth.signOut(); setPendingEmail(email.trim()); setStatus('needsVerification'); }
      return null;
    },
    async resendVerification(email) {
      const to = (email ?? pendingEmail ?? '').trim();
      if (!sb || !to) return unconfigured;
      const { error } = await sb.auth.resend({ type: 'signup', email: to, options: { emailRedirectTo: emailRedirectUrl() } });
      return error ? describeAuthError(error) : null;
    },
    async signOut() { if (sb) await sb.auth.signOut(); setUser(null); setPendingEmail(null); setStatus('signedOut'); },
    backToSignIn() { setPendingEmail(null); setStatus('signedOut'); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
