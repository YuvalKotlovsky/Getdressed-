import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { theme } from '../theme';

export function Icon({ name, size = 22, color = theme.ink }: { name: string; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name as any} size={size} color={color} />;
}
