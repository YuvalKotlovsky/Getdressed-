import React from 'react';
import { Image, Text, View } from 'react-native';
import { COLORS, theme } from '../theme';
import { categoryEmoji } from '../i18n';
import { text } from '../ui';
import type { Item } from '../types';

export function ItemTile({ item, size, showName = true }: { item: Item; size: number; showName?: boolean }) {
  const c = COLORS[item.color]?.hex ?? '#ddd';
  return (
    <View style={{ width: size, opacity: item.available ? 1 : 0.45 }}>
      <View style={{ width: size, height: size * 1.2, borderRadius: 16, overflow: 'hidden', backgroundColor: c + '55', alignItems: 'center', justifyContent: 'center' }}>
        {item.photoUri ? (
          <Image source={{ uri: item.photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <>
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '38%', backgroundColor: c + '99' }} />
            <Text style={{ fontSize: size * 0.42 }}>{categoryEmoji[item.category]}</Text>
            <Text style={{ position: 'absolute', top: 6, left: 6, fontSize: 9, color: theme.muted }}>דוגמה</Text>
          </>
        )}
        {!item.available && (
          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: theme.warn, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Text style={{ color: '#fff', fontSize: 11 }}>לא זמין</Text>
          </View>
        )}
      </View>
      {showName && <Text numberOfLines={2} style={[text(13, '500'), { marginTop: 6 }]}>{item.name}</Text>}
    </View>
  );
}
