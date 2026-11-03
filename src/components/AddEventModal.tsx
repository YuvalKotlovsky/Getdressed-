import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { theme } from '../theme';
import { occasionLabel } from '../i18n';
import { rowDir, text } from '../ui';
import { Chip } from './Chip';
import { Btn } from './Btn';
import { useApp } from '../state/AppContext';
import type { Occasion } from '../types';

export function AddEventModal({ date, visible, onClose }: { date: Date; visible: boolean; onClose: () => void }) {
  const { addManualEvent } = useApp();
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('09:00');
  const [occ, setOcc] = useState<Occasion>('work');
  const save = () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
    const d = new Date(date);
    d.setHours(m ? Math.min(23, +m[1]) : 9, m ? Math.min(59, +m[2]) : 0, 0, 0);
    addManualEvent({ id: `m-${Date.now()}`, title: title.trim() || occasionLabel[occ], start: d.getTime(), end: d.getTime() + 3600000, calendarId: 'manual', occasion: occ });
    setTitle('');
    onClose();
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0006' }} onPress={onClose} />
      <View style={{ backgroundColor: theme.bg, padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
        <Text style={text(20, '700')}>הוספת אירוע</Text>
        <TextInput value={title} onChangeText={setTitle} placeholder="שם האירוע" placeholderTextColor={theme.muted}
          style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.line, marginTop: 12 }]} />
        <TextInput value={time} onChangeText={setTime} placeholder="HH:MM" placeholderTextColor={theme.muted}
          style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.line, marginTop: 10 }]} />
        <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {(['work', 'workout', 'casual', 'evening', 'formal'] as Occasion[]).map((o) => <Chip key={o} label={occasionLabel[o]} on={occ === o} onPress={() => setOcc(o)} />)}
        </View>
        <View style={{ flexDirection: rowDir, gap: 10, marginTop: 18 }}>
          <Btn label="ביטול" kind="ghost" onPress={onClose} />
          <Btn label="שמירה" onPress={save} />
        </View>
      </View>
    </Modal>
  );
}
