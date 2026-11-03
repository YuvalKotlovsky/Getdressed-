import React, { useState } from 'react';
import { I18nManager, Pressable, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/state/AppContext';
import { TodayScreen } from './src/screens/TodayScreen';
import { WeekScreen } from './src/screens/WeekScreen';
import { ClosetScreen } from './src/screens/ClosetScreen';
import { theme } from './src/theme';
import { rowDir } from './src/ui';

I18nManager.allowRTL(true);

const TABS = [
  { key: 'today', label: 'היום', icon: '☀️', Screen: TodayScreen },
  { key: 'week', label: 'השבוע', icon: '🗓️', Screen: WeekScreen },
  { key: 'closet', label: 'הארון שלי', icon: '👗', Screen: ClosetScreen },
] as const;

function Shell() {
  const { ready } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('today');
  const Active = TABS.find((t) => t.key === tab)!.Screen;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        {ready ? <Active /> : null}
      </View>
      <View style={{ flexDirection: rowDir, borderTopWidth: 1, borderColor: theme.line, backgroundColor: theme.bg, paddingBottom: 4 }}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: tab === t.key }}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 10 }}>
            <Text style={{ fontSize: 22, opacity: tab === t.key ? 1 : 0.5 }}>{t.icon}</Text>
            <Text style={{ fontSize: 12, fontWeight: tab === t.key ? '700' : '400', color: tab === t.key ? theme.accent : theme.muted }}>{t.label}</Text>
          </Pressable>
        ))}
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
