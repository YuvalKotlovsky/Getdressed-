import React from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { theme } from '../theme';
import { rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';

export function ModeBar() {
  const { mode, setMode } = useApp();
  const demo = mode === 'demo';
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: rowDir, backgroundColor: theme.accentSoft, borderRadius: 14, padding: 4 }}>
        {(['demo', 'mine'] as const).map((m) => (
          <Pressable key={m} onPress={() => setMode(m)} style={{ flex: 1, paddingVertical: 8, borderRadius: 11, alignItems: 'center', backgroundColor: mode === m ? theme.card : 'transparent' }}>
            <Text style={{ fontSize: 14, fontWeight: mode === m ? '700' : '500', color: mode === m ? theme.ink : theme.muted }}>
              {m === 'demo' ? 'נתוני הדגמה' : 'הארון שלי'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]}>
        {demo ? 'מצב הדגמה: ארון ויומן לדוגמה, לא הנתונים שלכם.' : 'הארון שלכם, מאוחסן במכשיר בלבד. אירועים מתווספים ידנית עד חיבור היומן.'}
      </Text>
      {!demo && (
        <Pressable onPress={() => Alert.alert('חיבור ליומן', 'קריאת יומן הטלפון תתווסף בשלב הבא. בינתיים אפשר להוסיף אירועים ידנית.')} style={{ marginTop: 6 }}>
          <Text style={text(14, '600', theme.accent)}>חיבור ליומן</Text>
        </Pressable>
      )}
    </View>
  );
}
