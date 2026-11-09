import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { theme } from '../theme';
import { categoryLabel } from '../i18n';
import { rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';
import { ItemTile } from '../components/ItemTile';
import { ItemEditor, type EditorInitial } from '../components/ItemEditor';
import { AddItemSheet, type AddKind } from '../components/AddItemSheet';
import { LinkImport } from '../components/LinkImport';
import { ReceiptImport } from '../components/ReceiptImport';
import { AccountBar } from '../components/AccountBar';
import { Chip } from '../components/Chip';
import { Btn } from '../components/Btn';
import type { Category, Item } from '../types';

export function ClosetScreen() {
  const { data, saveItem, pendingIds } = useApp();
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const [editing, setEditing] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [flow, setFlow] = useState<AddKind | null>(null);
  const [initial, setInitial] = useState<EditorInitial | null>(null);
  const pick = (k: AddKind) => { setSheet(false); if (k === 'photo') { setEditing(null); setInitial(null); setOpen(true); } else setFlow(k); };
  const { width } = useWindowDimensions();
  const cols = 2;
  const size = Math.floor((Math.min(width, 560) - 40 - 16) / cols);
  const items = data.items.filter((i) => filter === 'all' || i.category === filter);

  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <Text style={[text(28, '700'), { marginBottom: 14 }]}>הארון שלי</Text>
      <AccountBar />
      <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <Chip label="הכל" on={filter === 'all'} onPress={() => setFilter('all')} />
        {(Object.keys(categoryLabel) as Category[]).map((c) => <Chip key={c} label={categoryLabel[c]} on={filter === c} onPress={() => setFilter(c)} />)}
      </View>
      <View style={{ flexDirection: 'row', marginBottom: 16 }}>
        <Btn label="הוספת פריט" onPress={() => setSheet(true)} />
      </View>

      {items.length === 0 && (
        <Text style={[text(16, '400', theme.muted), { marginVertical: 30, textAlign: 'center' }]}>
          {data.items.length === 0 ? 'הארון ריק. הוסיפו פריט ראשון מהגלריה.' : 'אין פריטים בקטגוריה הזו.'}
        </Text>
      )}
      <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 16 }}>
        {items.map((it) => (
          <View key={it.id}>
            <Pressable onPress={() => { setEditing(it); setInitial(null); setOpen(true); }}>
              <ItemTile item={it} size={size} unsynced={pendingIds.includes(it.id)} />
            </Pressable>
            <Pressable onPress={() => saveItem({ ...it, available: !it.available })} style={{ marginTop: 4 }}>
              <Text style={text(12, '600', it.available ? theme.muted : theme.ok)}>{it.available ? 'סימון כלא זמין' : 'החזרה לזמין'}</Text>
            </Pressable>
          </View>
        ))}
      </View>

      <ItemEditor item={editing} initial={initial} visible={open} onClose={() => { setOpen(false); setInitial(null); }} />
      <AddItemSheet visible={sheet} onClose={() => setSheet(false)} onPick={pick} />
      <LinkImport visible={flow === 'link'} onClose={() => setFlow(null)} onDone={(i) => { setFlow(null); setEditing(null); setInitial(i); setOpen(true); }} />
      <ReceiptImport visible={flow === 'receipt'} onClose={() => setFlow(null)} />
    </ScrollView>
  );
}
