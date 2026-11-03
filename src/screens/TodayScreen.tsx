import React, { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { theme } from '../theme';
import { dayNames } from '../i18n';
import { text } from '../ui';
import { useApp } from '../state/AppContext';
import { OutfitCard, Btn } from '../components/OutfitCard';
import { ModeBar } from '../components/ModeBar';
import { AddEventModal } from '../components/AddEventModal';

export function TodayScreen() {
  const { week, refresh, refreshing, mode } = useApp();
  const [adding, setAdding] = useState(false);
  const today = week[0];
  const now = new Date();
  return (
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.accent} />}>
      <Text style={text(34, '800')}>היום</Text>
      <Text style={[text(16, '400', theme.muted), { marginBottom: 14 }]}>
        יום {dayNames[now.getDay()]}, {now.getDate()}.{now.getMonth() + 1}
      </Text>
      <ModeBar />
      {today?.entries.map((e) => <OutfitCard key={e.key} dKey={today.dateKey} entry={e} isToday />)}
      {mode === 'mine' && <View style={{ flexDirection: 'row' }}><Btn label="הוספת אירוע להיום" kind="ghost" onPress={() => setAdding(true)} /></View>}
      <AddEventModal date={now} visible={adding} onClose={() => setAdding(false)} />
    </ScrollView>
  );
}
