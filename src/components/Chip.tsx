import React from 'react';
import { Pressable, Text } from 'react-native';
import { theme } from '../theme';

export function Chip({ label, on, onPress, swatch }: { label: string; on: boolean; onPress: () => void; swatch?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: on ? theme.accent : theme.accentSoft, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch ? <Text style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: swatch, borderWidth: 1, borderColor: '#0002' }}>{''}</Text> : null}
      <Text style={{ color: on ? '#fff' : theme.accent, fontSize: 14, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  );
}
