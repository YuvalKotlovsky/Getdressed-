import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { theme } from '../theme';
import { dayNames, occasionLabel, weatherLabel } from '../i18n';
import { addDays, startOfDay } from '../logic/dates';
import { cardStyle, rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';
import { OutfitCard } from '../components/OutfitCard';
import { Btn } from '../components/Btn';
import { Icon } from '../components/Icon';
import { AccountBar } from '../components/AccountBar';
import { ItemTile } from '../components/ItemTile';
import { WeatherLine } from '../components/WeatherLine';
import { AddEventModal } from '../components/AddEventModal';

export function WeekScreen() {
  const { week, refresh, refreshing } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<Date | null>(null);
  const base = startOfDay(new Date());
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}>
      <Text style={[text(28, '700'), { marginBottom: 16 }]}>השבוע</Text>
      <AccountBar />
      {week.map((day, i) => {
        const date = addDays(base, i);
        const isOpen = open === day.dateKey;
        const events = day.entries.filter((e) => e.event);
        const flagged = day.entries.some((e) => e.outfit.stale || e.outfit.missing.length || e.outfit.missingLayer);
        const w = day.entries[0]?.weather;
        return (
          <View key={day.dateKey} style={{ marginBottom: 12 }}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: isOpen }} onPress={() => setOpen(isOpen ? null : day.dateKey)}
              style={[cardStyle, { padding: 14 }, isOpen && { borderColor: theme.ink }]}>
              <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={text(17, '700')}>{i === 0 ? 'היום' : i === 1 ? 'מחר' : `יום ${dayNames[date.getDay()]}`} · {date.getDate()}.{date.getMonth() + 1}</Text>
                <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 6 }}>
                  {w && <Text style={text(12, '400', theme.muted)}>{Math.round(w.temp)}° {weatherLabel[w.band]}</Text>}
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.muted} />
                </View>
              </View>
              <Text style={[text(12, '400', flagged ? theme.warn : theme.muted), { marginTop: 2 }]}>
                {events.length === 0 ? 'יום חופשי' : events.length === 1 ? 'אירוע אחד' : `${events.length} אירועים`}{flagged ? ' · דורש תשומת לב' : ''}
              </Text>
              <View style={{ flexDirection: rowDir, gap: 8, marginTop: 10 }}>
                {day.entries.flatMap((e) => (e.outfit.layer ? [...e.outfit.items, e.outfit.layer] : e.outfit.items)).slice(0, 5).map((it) => <ItemTile key={it.id} item={it} size={54} showName={false} />)}
              </View>
              {!isOpen && events.length > 0 && (
                <Text style={[text(12, '400', theme.muted), { marginTop: 8 }]}>{events.map((e) => `${e.event!.title} (${occasionLabel[e.occasion]})`).join(' · ')}</Text>
              )}
            </Pressable>
            {isOpen && (
              <View style={{ marginTop: 12 }}>
                <WeatherLine dKey={day.dateKey} />
                {day.entries.map((e) => <OutfitCard key={e.key} dKey={day.dateKey} entry={e} isToday={i === 0} />)}
                <View style={{ flexDirection: 'row' }}><Btn label="הוספת אירוע" kind="ghost" onPress={() => setAdding(date)} /></View>
              </View>
            )}
          </View>
        );
      })}
      <AddEventModal date={adding ?? base} visible={!!adding} onClose={() => setAdding(null)} />
    </ScrollView>
  );
}
