import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
import type { AuthFail } from '../auth/errors';
import { Btn } from '../components/Btn';
import { theme } from '../theme';
import { text } from '../ui';

const input = { ...text(16), borderWidth: 1, borderColor: theme.lineStrong, borderRadius: 12, backgroundColor: theme.card, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 12 } as const;
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, width: '100%', maxWidth: 420, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Text style={[text(30, '700'), { marginBottom: 6 }]}>Wear My Week</Text>
        {children}
      </ScrollView>
    </KeyboardAvoidingView></SafeAreaView>
  );
}

/** Seconds left until the next request is allowed (server cooldown for the same address is 60s). */
function useCooldown() {
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => { if (until <= Date.now()) return; const id = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(id); }, [until]);
  return { left: Math.max(0, Math.ceil((until - Date.now()) / 1000)), start: (sec: number) => setUntil(Date.now() + sec * 1000) };
}

/** Registration + sign-in. Nothing in the app is reachable without a verified account. */
export function AuthScreen() {
  const { status, pendingEmail, linkNotice, dismissLinkNotice, signIn, signUp, resendVerification, backToSignIn } = useAuth();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const lock = useRef(false); // blocks a second submit while one is in flight (Enter + tap, double tap)
  const cooldown = useCooldown();
  const run = async (job: () => Promise<AuthFail | null>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null); setInfo(null);
    try {
      const f = await job();
      if (f) { setError(f.text); if (f.retryAfterSec) cooldown.start(f.retryAfterSec); }
    } finally { lock.current = false; setBusy(false); }
  };

  if (status === 'loading') return <Frame><ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} /></Frame>;

  if (status === 'unconfigured') {
    return <Frame><Text style={text(16, '400', theme.muted)}>הגרסה הזו לא מחוברת לשירות החשבונות, ולכן אי אפשר להתחבר. (חסרות הגדרות Supabase בבנייה.)</Text></Frame>;
  }

  if (status === 'needsVerification') {
    return (
      <Frame>
        <Text style={[text(22, '600'), { marginTop: 12 }]}>בדקו את תיבת הדואר</Text>
        <Text style={[text(15, '400', theme.muted), { marginVertical: 12 }]}>שלחנו קישור אישור אל {pendingEmail}. לחיצה אחת על "אישור כתובת האימייל" תאמת את החשבון ותפתח את הארון, בלי להתחבר שוב. לא רואים? בדקו גם בספאם.</Text>
        {info && <Text style={[text(14, '600', theme.ok), { marginBottom: 8 }]}>{info}</Text>}
        {error && <Text style={[text(14, '600', theme.warn), { marginBottom: 8 }]}>{error}</Text>}
        <View style={{ flexDirection: 'row' }}>
          <Btn label={cooldown.left > 0 ? `שליחה חוזרת (${cooldown.left})` : busy ? 'רגע…' : 'שליחה חוזרת'} kind="ghost" disabled={busy || cooldown.left > 0}
            onPress={() => run(async () => { const f = await resendVerification(); if (!f) { setInfo('נשלח שוב.'); cooldown.start(60); } return f; })} />
        </View>
        <Pressable onPress={() => { setError(null); setInfo(null); cooldown.start(0); backToSignIn(); }} style={{ marginTop: 16, alignItems: 'center' }}>
          <Text style={text(14, '600', theme.accent)}>שימוש בכתובת אחרת</Text>
        </Pressable>
      </Frame>
    );
  }

  const submit = () => {
    if (lock.current || cooldown.left > 0) return;
    setError(null); setInfo(null);
    if (!emailOk(email)) { setError('כתובת האימייל לא תקינה.'); return; }
    if (register && password.length < 8) { setError('הסיסמה צריכה להכיל 8 תווים לפחות.'); return; }
    if (!password) { setError('הכניסו סיסמה.'); return; }
    run(async () => { const f = register ? await signUp(email, password) : await signIn(email, password); if (!f && register) cooldown.start(60); return f; });
  };

  const noticeBox = linkNotice && (
    <View style={{ marginBottom: 16, padding: 14, borderRadius: 12, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.line }}>
      {linkNotice === 'expired' ? (
        <>
          <Text style={text(15, '700')}>קישור האישור כבר לא תקף</Text>
          <Text style={[text(14, '400', theme.muted), { marginTop: 6 }]}>הוא פג תוקף או שכבר נעשה בו שימוש. אם החשבון כבר אומת, פשוט התחברו. אחרת, הכניסו את האימייל ונשלח קישור חדש.</Text>
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            <Btn label={cooldown.left > 0 ? `שליחת קישור חדש (${cooldown.left})` : 'שליחת קישור חדש'} kind="ghost" disabled={busy || cooldown.left > 0}
              onPress={() => { if (!emailOk(email)) { setError('הכניסו את כתובת האימייל למעלה.'); return; } run(async () => { const f = await resendVerification(email); if (!f) { setInfo('אם החשבון עדיין לא אומת, נשלח אליו קישור חדש.'); cooldown.start(60); } return f; }); }} />
          </View>
        </>
      ) : (
        <>
          <Text style={text(15, '700')}>האימייל אומת</Text>
          <Text style={[text(14, '400', theme.muted), { marginTop: 6 }]}>לא הצלחנו לחבר אתכם אוטומטית בדפדפן הזה. התחברו עם האימייל והסיסמה כרגיל.</Text>
        </>
      )}
      <Pressable onPress={dismissLinkNotice} style={{ marginTop: 10 }}><Text style={text(13, '600', theme.accent)}>סגירה</Text></Pressable>
    </View>
  );

  return (
    <Frame>
      {noticeBox}
      <Text style={[text(15, '400', theme.muted), { marginBottom: 20 }]}>{register ? 'יצירת חשבון חדש. הארון מתחיל ריק.' : 'התחברו לארון שלכם.'}</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="אימייל" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" style={input} accessibilityLabel="אימייל" />
      <TextInput value={password} onChangeText={setPassword} placeholder="סיסמה" secureTextEntry autoCapitalize="none" textContentType={register ? 'newPassword' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} onSubmitEditing={submit} style={input} accessibilityLabel="סיסמה" />
      {info && <Text style={[text(14, '600', theme.ok), { marginBottom: 10 }]}>{info}</Text>}
      {error && <Text style={[text(14, '600', theme.warn), { marginBottom: 10 }]}>{error}</Text>}
      <View style={{ flexDirection: 'row' }}><Btn label={busy ? 'רגע…' : cooldown.left > 0 ? `נסו שוב בעוד ${cooldown.left} שניות` : register ? 'יצירת חשבון' : 'התחברות'} onPress={submit} disabled={busy || cooldown.left > 0} /></View>
      <Pressable onPress={() => { setRegister((r) => !r); setError(null); }} style={{ marginTop: 16, alignItems: 'center' }}>
        <Text style={text(14, '600', theme.accent)}>{register ? 'כבר יש לי חשבון' : 'אין לי חשבון עדיין'}</Text>
      </Pressable>
    </Frame>
  );
}
