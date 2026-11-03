import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { CITIES } from '../weather/weather';
import { theme } from '../theme';
import { weatherLabel } from '../i18n';
import { cardStyle, rowDir, text } from '../ui';
import { useApp } from '../state/AppContext';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { Btn } from './Btn';
import type { Weather } from '../types';

const SRC = { forecast: 'תחזית', season: 'הערכה עונתית', manual: 'ידני' } as const;

/** City + weather for one day, with a manual override. */
export function WeatherLine({ dKey }: { dKey: string }) {
  const { week, city, setCity, weatherOverride, setWeatherOverride, forecastStatus } = useApp();
  const [open, setOpen] = useState(false);
  const day = week.find((d) => d.dateKey === dKey);
  const w = day?.entries[0]?.weather;
  const ov = weatherOverride[dKey] ?? null;
  return (
    <View style={[cardStyle, { padding: 12, marginBottom: 16 }]}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" style={{ flexDirection: rowDir, alignItems: 'center', gap: 8 }}>
        <Icon name="weather-partly-cloudy" size={20} color={theme.accent} />
        <Text style={[text(14, '600'), { flex: 1 }]}>
          {city.name}{w ? ` · ${Math.round(w.temp)}° ${weatherLabel[w.band]}` : ''}
        </Text>
        <Text style={text(12, '400', theme.muted)}>
          {w ? SRC[w.source] : ''}{w?.source === 'season' && forecastStatus === 'unavailable' ? ' (אין תחזית)' : ''}
        </Text>
      </Pressable>
      <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <Chip label="אוטומטי" on={!ov} onPress={() => setWeatherOverride(dKey, null)} />
        {(['hot', 'mild', 'cold'] as Weather[]).map((b) => <Chip key={b} label={weatherLabel[b]} on={ov === b} onPress={() => setWeatherOverride(dKey, b)} />)}
      </View>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#0005', justifyContent: 'flex-end' }} onPress={() => setOpen(false)}>
          <Pressable style={{ backgroundColor: theme.bg, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
            <Text style={text(18, '700')}>בחירת עיר לתחזית</Text>
            <Text style={[text(12, '400', theme.muted), { marginTop: 4, marginBottom: 12 }]}>
              {forecastStatus === 'live' ? 'התחזית נטענה.' : forecastStatus === 'loading' ? 'טוען תחזית…' : 'אין תחזית כרגע, משתמשים בהערכה לפי עונת השנה ואפשר לקבוע מזג אוויר ידנית.'}
            </Text>
            <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
              {CITIES.map((c) => <Chip key={c.id} label={c.name} on={city.id === c.id} onPress={() => setCity(c.id)} />)}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 18 }}><Btn label="סגירה" onPress={() => setOpen(false)} /></View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
