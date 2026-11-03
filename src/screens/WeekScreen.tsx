import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { theme } from '../theme';
import { dayNames, occasionLabel } from '../i18n';
import { addDays, startOfDay } from '../logic/dates';
import { rowDir, shadow, text } from '../ui';
import { useApp } from '../state/AppContext';
import { OutfitCard, Btn } from '../components/OutfitCard';
import { ModeBar } from '../components/ModeBar';
import { ItemTile } from '../components/ItemTile';
import { AddEventModal } from '../components/AddEventModal';

export function WeekScreen() {
  const { week, refresh, refreshing, mode } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<Date | null>(null);
  const base = startOfDay(new Date());
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}>
      <Text style={[text(34, '800'), { marginBottom: 14 }]}>השבוע</Text>
      <ModeBar />
      {week.map((day, i) => {
        const date = addDays(base, i);
        const isOpen = open === day.dateKey;
        const events = day.entries.filter((e) => e.event);
        const flagged = day.entries.some((e) => e.outfit.stale || e.outfit.missing.length);
        return (
          <View key={day.dateKey} style={[{ backgroundColor: theme.card, borderRadius: theme.radius, marginBottom: 14, overflow: 'hidden' }, shadow]}>
            <Pressable onPress={() => setOpen(isOpen ? null : day.dateKey)} style={{ padding: 16 }}>
              <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={text(19, '700')}>{i === 0 ? 'היום' : i === 1 ? 'מחר' : `יום ${dayNames[date.getDay()]}`} · {date.getDate()}.{date.getMonth() + 1}</Text>
                <Text style={text(13, '500', flagged ? theme.warn : theme.muted)}>
                  {events.length ? `${events.length} אירועים` : 'יום חופשי'}{flagged ? ' · דורש תשומת לב' : ''}
                </Text>
              </View>
              <View style={{ flexDirection: rowDir, gap: 8, marginTop: 10 }}>
                {day.entries.flatMap((e) => e.outfit.items).slice(0, 5).map((it) => <ItemTile key={it.id} item={it} size={52} showName={false} />)}
              </View>
              {!isOpen && events.length > 0 && (
                <Text style={[text(13, '400', theme.muted), { marginTop: 8 }]}>{events.map((e) => `${e.event!.title} (${occasionLabel[e.occasion]})`).join(' · ')}</Text>
              )}
            </Pressable>
            {isOpen && (
              <View style={{ paddingHorizontal: 12 }}>
                {day.entries.map((e) => <OutfitCard key={e.key} dKey={day.dateKey} entry={e} isToday={i === 0} />)}
                {mode === 'mine' && <View style={{ flexDirection: 'row', marginBottom: 14 }}><Btn label="הוספת אירוע" kind="ghost" onPress={() => setAdding(date)} /></View>}
              </View>
            )}
          </View>
        );
      })}
      <AddEventModal date={adding ?? base} visible={!!adding} onClose={() => setAdding(null)} />
    </ScrollView>
  );
}
