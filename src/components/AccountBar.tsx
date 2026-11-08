import React, { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import { CalendarSheet } from './CalendarSheet';
import { theme } from '../theme';
import { rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';

function confirm(title: string, body: string, yes: string, onYes: () => void) {
  if (Platform.OS === 'web') { if (window.confirm(`${title}\n${body}`)) onYes(); return; }
  Alert.alert(title, body, [{ text: 'ביטול', style: 'cancel' }, { text: yes, style: 'destructive', onPress: onYes }]);
}

/** Account, cloud-save status and calendar link. Replaces the old demo/mine switch. */
export function AccountBar() {
  const { accountEmail, settings, pendingIds, syncing, offline, localSaveFailed, retrySync, signOutAccount, staleEdits, restoreStaleEdit, dismissStaleEdit } = useApp();
  const [cal, setCal] = useState(false);
  const n = pendingIds.length;
  const unsaved = n + staleEdits.length;
  const signOut = () => {
    if (unsaved > 0) confirm('יש שינויים שלא נשמרו בענן', `${unsaved} שינויים עדיין לא הגיעו לענן ויימחקו מהמכשיר אם תתנתקו עכשיו. להתנתק בכל זאת?`, 'התנתקות', () => { signOutAccount(); });
    else signOutAccount();
  };
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: rowDir, alignItems: 'center', justifyContent: 'space-between', backgroundColor: theme.accentSoft, borderRadius: 12, paddingVertical: 9, paddingHorizontal: 12 }}>
        <Text style={[text(13, '500'), { flexShrink: 1 }]} numberOfLines={1}>{accountEmail}</Text>
        <Pressable accessibilityRole="button" onPress={signOut}><Text style={text(13, '600', theme.accent)}>התנתקות</Text></Pressable>
      </View>
      {n > 0 ? (
        <Pressable accessibilityRole="button" onPress={retrySync} style={{ marginTop: 6 }}>
          <Text style={text(12, '600', theme.warn)}>
            {syncing ? 'שומר בענן…' : offline ? `${n} פריטים לא נשמרו בענן (אין חיבור). לחצו לניסיון חוזר.` : `${n} פריטים לא נשמרו בענן. לחצו לניסיון חוזר.`}
          </Text>
        </Pressable>
      ) : (
        <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]}>{syncing ? 'מסנכרן…' : offline ? 'אין חיבור לענן. מוצג מה שנשמר במכשיר.' : 'הארון והתמונות שלו נשמרים בחשבון שלכם באחסון ענן פרטי ומסונכרנים בין המכשירים.'}</Text>
      )}
      {staleEdits.map((c) => (
        <View key={c.id} style={{ marginTop: 8, backgroundColor: theme.warnSoft, borderRadius: 12, padding: 12 }}>
          <Text style={text(13, '600', theme.warn)}>הפריט “{c.item.name}” נמחק ממכשיר אחר, ולכן העריכה האחרונה שלכם לא נשמרה.{!c.item.photoUri && c.item.photoPath ? ' התמונה לא שמורה במכשיר הזה, ולכן פריט חדש יישמר בלי תמונה.' : ''}</Text>
          <View style={{ flexDirection: rowDir, gap: 16, marginTop: 8 }}>
            <Pressable accessibilityRole="button" onPress={() => restoreStaleEdit(c.id)}><Text style={text(13, '600', theme.accent)}>שמירה כפריט חדש</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => dismissStaleEdit(c.id)}><Text style={text(13, '400', theme.muted)}>התעלמות</Text></Pressable>
          </View>
        </View>
      ))}
      {localSaveFailed && <Text style={[text(12, '600', theme.warn), { marginTop: 4 }]}>לא הצלחנו לשמור במכשיר. פנו מקום ונסו שוב.</Text>}
      <Pressable onPress={() => setCal(true)} style={{ marginTop: 6 }}>
        <Text style={text(14, '600', theme.accent)}>{settings.calendarConnected ? 'יומן מחובר · שינוי' : 'חיבור ליומן'}</Text>
      </Pressable>
      <CalendarSheet visible={cal} onClose={() => setCal(false)} />
    </View>
  );
}
