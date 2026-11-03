import React, { useState } from 'react';
import { I18nManager, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/state/AppContext';
import { TodayScreen } from './src/screens/TodayScreen';
import { WeekScreen } from './src/screens/WeekScreen';
import { ClosetScreen } from './src/screens/ClosetScreen';
import { Icon } from './src/components/Icon';
import { theme } from './src/theme';
import { rowDir } from './src/ui';

I18nManager.allowRTL(true);

const TABS = [
  { key: 'today', label: 'היום', icon: 'weather-sunny', Screen: TodayScreen },
  { key: 'week', label: 'השבוע', icon: 'calendar-week-outline', Screen: WeekScreen },
  { key: 'closet', label: 'הארון שלי', icon: 'wardrobe-outline', Screen: ClosetScreen },
] as const;

function Shell() {
  const { ready } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('today');
  const Active = TABS.find((t) => t.key === tab)!.Screen;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>{ready ? <Active /> : null}</View>
      <View style={{ flexDirection: rowDir, borderTopWidth: 1, borderColor: theme.line, backgroundColor: theme.bg }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={{ flex: 1, alignItems: 'center', paddingBottom: 8, paddingTop: 6, borderTopWidth: 2, borderTopColor: on ? theme.ink : 'transparent', marginTop: -1 }}>
              <Icon name={t.icon} size={24} color={on ? theme.ink : theme.muted} />
              <Text style={{ fontSize: 12, marginTop: 2, fontWeight: on ? '700' : '400', color: on ? theme.ink : theme.muted }}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}
