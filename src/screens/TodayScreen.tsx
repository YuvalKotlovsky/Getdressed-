import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { theme } from '../theme';
import { dayNames } from '../i18n';
import { text } from '../ui';
import { useApp } from '../state/AppContext';
import { OutfitCard } from '../components/OutfitCard';
import { Btn } from '../components/Btn';
import { ModeBar } from '../components/ModeBar';
import { WeatherLine } from '../components/WeatherLine';
import { AddEventModal } from '../components/AddEventModal';

export function TodayScreen() {
  const { week, refresh, refreshing, mode } = useApp();
  const [adding, setAdding] = useState(false);
  const today = week[0];
  const now = new Date();
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}>
      <Text style={text(28, '700')}>היום</Text>
      <Text style={[text(14, '400', theme.muted), { marginBottom: 16 }]}>יום {dayNames[now.getDay()]}, {now.getDate()}.{now.getMonth() + 1}</Text>
      <ModeBar />
      {today && <WeatherLine dKey={today.dateKey} />}
      {today?.entries.map((e) => <OutfitCard key={e.key} dKey={today.dateKey} entry={e} isToday />)}
      {mode === 'mine' && <View style={{ flexDirection: 'row' }}><Btn label="הוספת אירוע להיום" kind="ghost" onPress={() => setAdding(true)} /></View>}
      <AddEventModal date={now} visible={adding} onClose={() => setAdding(false)} />
    </ScrollView>
  );
}
