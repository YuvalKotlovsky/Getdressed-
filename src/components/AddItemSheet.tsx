import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { theme } from '../theme';
import { cardStyle, rowDir, text } from '../ui';
import { Icon } from './Icon';

export type AddKind = 'photo' | 'link' | 'receipt';
const OPTIONS: { kind: AddKind; icon: string; title: string; sub: string }[] = [
  { kind: 'photo', icon: 'camera-outline', title: 'צילום או גלריה', sub: 'בגד אחד בכל תמונה, עם הצעת תיוג' },
  { kind: 'link', icon: 'link-variant', title: 'הדבקת קישור למוצר', sub: 'קוראים שם, תמונה, צבע ומק״ט מדף ציבורי' },
  { kind: 'receipt', icon: 'receipt-text-outline', title: 'סריקת קבלה', sub: 'כמה פריטים בבת אחת, עם בדיקה לפני שמירה' },
];

export function AddItemSheet({ visible, onClose, onPick }: { visible: boolean; onClose: () => void; onPick: (k: AddKind) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0005' }} onPress={onClose} />
      <View style={{ backgroundColor: theme.bg, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <Text style={[text(20, '700'), { marginBottom: 12 }]}>הוספת פריט</Text>
        {OPTIONS.map((o) => (
          <Pressable key={o.kind} accessibilityRole="button" onPress={() => onPick(o.kind)} style={[cardStyle, { padding: 14, marginBottom: 10, flexDirection: rowDir, alignItems: 'center', gap: 12 }]}>
            <Icon name={o.icon} size={24} color={theme.accent} />
            <View style={{ flex: 1 }}>
              <Text style={text(16, '600')}>{o.title}</Text>
              <Text style={text(12, '400', theme.muted)}>{o.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
