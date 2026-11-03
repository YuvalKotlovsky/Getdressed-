import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { theme } from '../theme';
import { cardStyle, rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';
import { Btn } from './Btn';
import { Chip } from './Chip';
import { NativeCalendarProvider, getCalendarPermission, nativeCalendarSupported, requestCalendarPermission, type CalendarPermission } from '../calendar/native';
import type { CalendarInfo } from '../calendar/provider';

/** "חיבור ליומן": permission -> choose calendars. Manual events always stay available. */
export function CalendarSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { settings, updateSettings, refresh } = useApp();
  const [perm, setPerm] = useState<CalendarPermission>('undetermined');
  const [cals, setCals] = useState<CalendarInfo[]>([]);
  const [sel, setSel] = useState<string[]>([]);

  const load = async () => {
    const p = await getCalendarPermission();
    setPerm(p);
    if (p === 'granted') setCals(await new NativeCalendarProvider(() => []).listCalendars());
  };
  useEffect(() => { if (visible) { setSel(settings.calendarIds ?? []); load(); } }, [visible]);

  const ask = async () => { const p = await requestCalendarPermission(); setPerm(p); if (p === 'granted') await load(); };
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const save = () => { updateSettings({ calendarConnected: sel.length > 0, calendarIds: sel }); refresh(); onClose(); };
  const disconnect = () => { updateSettings({ calendarConnected: false, calendarIds: [] }); refresh(); onClose(); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0005' }} onPress={onClose} />
      <View style={{ backgroundColor: theme.bg, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}>
        <Text style={text(20, '700')}>חיבור ליומן</Text>
        <ScrollView>
          {!nativeCalendarSupported && (
            <Text style={[text(14, '400', theme.muted), { marginTop: 10 }]}>
              קריאת היומן זמינה רק באפליקציה בטלפון (iPhone או Android). בדפדפן אפשר להוסיף אירועים ידנית, והם יתנהגו אותו דבר.
            </Text>
          )}
          {nativeCalendarSupported && perm !== 'granted' && (
            <View style={[cardStyle, { padding: 14, marginTop: 12 }]}>
              <Text style={text(14, '500')}>האפליקציה תקרא את האירועים מהיומן שבחרתם, רק במכשיר. שום דבר מהיומן לא נשלח החוצה.</Text>
              {perm === 'denied' && <Text style={[text(13, '500', theme.warn), { marginTop: 8 }]}>הגישה נדחתה. אפשר להמשיך עם אירועים ידניים, או לאפשר גישה בהגדרות המכשיר ← Wear My Week ← יומנים.</Text>}
              <View style={{ flexDirection: 'row', marginTop: 12 }}><Btn label="אישור גישה ליומן" onPress={ask} /></View>
            </View>
          )}
          {nativeCalendarSupported && perm === 'granted' && (
            <>
              <Text style={[text(13, '600', theme.muted), { marginTop: 14, marginBottom: 8 }]}>אילו יומנים לכלול?</Text>
              {cals.length === 0 && <Text style={text(13, '400', theme.muted)}>לא נמצאו יומנים במכשיר.</Text>}
              <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
                {cals.map((c) => <Chip key={c.id} label={c.title} on={sel.includes(c.id)} onPress={() => toggle(c.id)} />)}
              </View>
              <View style={{ flexDirection: rowDir, gap: 10, marginTop: 16 }}>
                <Btn label="שמירה" onPress={save} />
              </View>
              {settings.calendarConnected && <Pressable onPress={disconnect} style={{ marginTop: 14 }}><Text style={text(13, '600', theme.warn)}>ניתוק היומן</Text></Pressable>}
            </>
          )}
        </ScrollView>
        <View style={{ flexDirection: 'row', marginTop: 14 }}><Btn label="סגירה" kind="ghost" onPress={onClose} /></View>
      </View>
    </Modal>
  );
}
