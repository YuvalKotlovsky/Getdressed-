import React from 'react';
import { Pressable, Text } from 'react-native';
import { theme } from '../theme';

export function Btn({ label, onPress, kind = 'solid', disabled, flex = true }: { label: string; onPress: () => void; kind?: 'solid' | 'ghost'; disabled?: boolean; flex?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: flex ? 1 : undefined, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', opacity: disabled ? 0.4 : 1,
        backgroundColor: kind === 'solid' ? theme.accent : theme.card,
        borderWidth: 1, borderColor: kind === 'solid' ? theme.accent : theme.lineStrong,
      }}
    >
      <Text style={{ color: kind === 'solid' ? '#fff' : theme.ink, fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
