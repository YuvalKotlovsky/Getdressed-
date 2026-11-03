import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useState } from 'react';
import { CalendarSheet } from './CalendarSheet';
import { theme } from '../theme';
import { rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';

export function ModeBar() {
  const { mode, setMode, settings } = useApp();
  const [cal, setCal] = useState(false);
  const demo = mode === 'demo';
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: rowDir, backgroundColor: theme.accentSoft, borderRadius: 12, padding: 3 }}>
        {(['demo', 'mine'] as const).map((m) => {
          const on = mode === m;
          return (
            <Pressable key={m} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setMode(m)}
              style={{ flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: on ? theme.card : 'transparent', borderWidth: 1, borderColor: on ? theme.lineStrong : 'transparent' }}>
              <Text style={{ fontSize: 14, fontWeight: on ? '700' : '400', color: on ? theme.ink : theme.muted }}>{m === 'demo' ? 'נתוני הדגמה' : 'הארון שלי'}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]}>
        {demo ? 'מצב הדגמה: ארון ויומן לדוגמה, לא הנתונים שלכם.' : 'הארון שלכם, שמור במכשיר בלבד. אפשר להוסיף אירועים ידנית או לחבר את יומן הטלפון.'}
      </Text>
      {!demo && (
        <Pressable onPress={() => setCal(true)} style={{ marginTop: 6 }}>
          <Text style={text(14, '600', theme.accent)}>{settings.calendarConnected ? 'יומן מחובר · שינוי' : 'חיבור ליומן'}</Text>
        </Pressable>
      )}
      <CalendarSheet visible={cal} onClose={() => setCal(false)} />
    </View>
  );
}
