import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { theme } from '../theme';
import { categoryLabel } from '../i18n';
import { rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';
import { ItemTile } from '../components/ItemTile';
import { ItemEditor } from '../components/ItemEditor';
import { ModeBar } from '../components/ModeBar';
import { Chip } from '../components/Chip';
import { Btn } from '../components/Btn';
import type { Category, Item } from '../types';

export function ClosetScreen() {
  const { data, mode, resetDemo, saveItem } = useApp();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const { width } = useWindowDimensions();
  const cols = 2;
  const size = Math.floor((Math.min(width, 560) - 40 - 16) / cols);
  const items = data.items.filter((i) => filter === 'all' || i.category === filter);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={[text(28, '700'), { marginBottom: 14 }]}>הארון שלי</Text>
      <ModeBar />
      <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Chip label="הכל" on={filter === 'all'} onPress={() => setFilter('all')} />
        {(Object.keys(categoryLabel) as Category[]).map((c) => <Chip key={c} label={categoryLabel[c]} on={filter === c} onPress={() => setFilter(c)} />)}
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 16 }}>
        <Btn label="הוספת פריט" onPress={() => { setEditing(null); setOpen(true); }} />
      </View>

      {items.length === 0 && (
        <Text style={[text(16, '400', theme.muted), { marginVertical: 30, textAlign: 'center' }]}>
          {mode === 'mine' ? 'הארון ריק. הוסיפו פריט ראשון מהגלריה.' : 'אין פריטים בקטגוריה הזו.'}
        </Text>
      )}
      <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 16 }}>
        {items.map((it) => (
          <View key={it.id}>
            <Pressable onPress={() => { setEditing(it); setOpen(true); }}>
              <ItemTile item={it} size={size} />
            </Pressable>
            <Pressable onPress={() => saveItem({ ...it, available: !it.available })} style={{ marginTop: 4 }}>
              <Text style={text(12, '600', it.available ? theme.muted : theme.ok)}>{it.available ? 'סימון כלא זמין' : 'החזרה לזמין'}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      {mode === 'demo' && (
        <Pressable onPress={() => Alert.alert('איפוס ארון ההדגמה', 'להחזיר את ארון ההדגמה למצבו המקורי?', [{ text: 'ביטול' }, { text: 'איפוס', onPress: resetDemo }])} style={{ marginTop: 30 }}>
          <Text style={text(14, '600', theme.muted)}>איפוס ארון ההדגמה</Text>
        </Pressable>
      )}
      <ItemEditor item={editing} visible={open} onClose={() => setOpen(false)} />
    </ScrollView>
  );
}
