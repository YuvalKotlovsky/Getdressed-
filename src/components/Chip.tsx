import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { theme } from '../theme';
import { rowDir } from '../ui';

export function Chip({ label, on, onPress, swatch, flag }: { label: string; on: boolean; onPress: () => void; swatch?: string; flag?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} aria-selected={on}
      style={{
        paddingHorizontal: 13, paddingVertical: 7, borderRadius: 999, flexDirection: rowDir, alignItems: 'center', gap: 6,
        backgroundColor: on ? theme.ink : theme.card, borderWidth: 1, borderColor: on ? theme.ink : flag ? theme.warn : theme.lineStrong,
      }}>
      {swatch ? <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: swatch, borderWidth: 1, borderColor: '#0002' }} /> : null}
      <Text style={{ color: on ? '#fff' : theme.ink, fontSize: 14, fontWeight: on ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}
