import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthContext';
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

/** Registration + sign-in. Nothing in the app is reachable without a verified account. */
export function AuthScreen() {
  const { status, pendingEmail, signIn, signUp, resendVerification, backToSignIn } = useAuth();
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (status === 'loading') return <Frame><ActivityIndicator color={theme.accent} style={{ marginTop: 24 }} /></Frame>;

  if (status === 'unconfigured') {
    return <Frame><Text style={text(16, '400', theme.muted)}>הגרסה הזו לא מחוברת לשירות החשבונות, ולכן אי אפשר להתחבר. (חסרות הגדרות Supabase בבנייה.)</Text></Frame>;
  }

  if (status === 'needsVerification') {
    return (
      <Frame>
        <Text style={[text(20, '600'), { marginTop: 12 }]}>אמתו את כתובת האימייל</Text>
        <Text style={[text(15, '400', theme.muted), { marginVertical: 12 }]}>שלחנו קישור אימות אל {pendingEmail}. אחרי שתלחצו עליו, חזרו לכאן והתחברו. הארון נפתח רק אחרי אימות.</Text>
        {info && <Text style={[text(14, '600', theme.ok), { marginBottom: 8 }]}>{info}</Text>}
        {error && <Text style={[text(14, '600', theme.warn), { marginBottom: 8 }]}>{error}</Text>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Btn label="שליחה חוזרת" kind="ghost" disabled={busy} onPress={async () => { setBusy(true); setError(null); const e = await resendVerification(); setBusy(false); if (e) setError(e); else setInfo('נשלח שוב.'); }} />
          <Btn label="יש לי כבר אימות" onPress={() => { setError(null); setInfo(null); backToSignIn(); }} />
        </View>
      </Frame>
    );
  }

  const submit = async () => {
    setError(null); setInfo(null);
    if (!emailOk(email)) { setError('כתובת האימייל לא תקינה.'); return; }
    if (register && password.length < 8) { setError('הסיסמה צריכה להכיל 8 תווים לפחות.'); return; }
    if (!password) { setError('הכניסו סיסמה.'); return; }
    setBusy(true);
    const err = register ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <Frame>
      <Text style={[text(15, '400', theme.muted), { marginBottom: 20 }]}>{register ? 'יצירת חשבון חדש. הארון מתחיל ריק.' : 'התחברו לארון שלכם.'}</Text>
      <TextInput value={email} onChangeText={setEmail} placeholder="אימייל" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" style={input} accessibilityLabel="אימייל" />
      <TextInput value={password} onChangeText={setPassword} placeholder="סיסמה" secureTextEntry autoCapitalize="none" textContentType={register ? 'newPassword' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} onSubmitEditing={submit} style={input} accessibilityLabel="סיסמה" />
      {error && <Text style={[text(14, '600', theme.warn), { marginBottom: 10 }]}>{error}</Text>}
      <View style={{ flexDirection: 'row' }}><Btn label={busy ? 'רגע…' : register ? 'יצירת חשבון' : 'התחברות'} onPress={submit} disabled={busy} /></View>
      <Pressable onPress={() => { setRegister((r) => !r); setError(null); }} style={{ marginTop: 16, alignItems: 'center' }}>
        <Text style={text(14, '600', theme.accent)}>{register ? 'כבר יש לי חשבון' : 'אין לי חשבון עדיין'}</Text>
      </Pressable>
    </Frame>
  );
}
