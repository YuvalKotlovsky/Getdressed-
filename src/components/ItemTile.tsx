import React from 'react';
import { Image, Text, View } from 'react-native';
import { COLORS, theme } from '../theme';
import { categoryIcon } from '../i18n';
import { text } from '../ui';
import { Icon } from './Icon';
import type { Item } from '../types';
import { useItemPhoto } from '../cloud/useItemPhoto';

/** Photo-first tile. Real photos keep their original colours; demo items get a quiet placeholder. */
export function ItemTile({ item, size, showName = true, caption, unsynced }: { item: Item; size: number; showName?: boolean; caption?: string; unsynced?: boolean }) {
  const photo = useItemPhoto(item);
  const dot = COLORS[item.color]?.hex;
  return (
    <View style={{ width: size }}>
      <View style={{ width: size, height: Math.round(size * 1.25), borderRadius: 12, overflow: 'hidden', backgroundColor: theme.accentSoft, alignItems: 'center', justifyContent: 'center', opacity: item.available ? 1 : 0.4 }}>
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
        ) : (
          <>
            <Icon name={categoryIcon[item.category]} size={Math.round(size * 0.42)} color={theme.lineStrong} />
            {dot && <View style={{ position: 'absolute', bottom: 8, right: 8, width: 12, height: 12, borderRadius: 6, backgroundColor: dot, borderWidth: 1, borderColor: '#0002' }} />}
          </>
        )}
      </View>
      {unsynced && (
        <View style={{ position: 'absolute', bottom: showName ? 40 : 6, left: 6, backgroundColor: theme.warn, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: 10 }}>לא נשמר בענן</Text>
        </View>
      )}
      {!item.available && (
        <View style={{ position: 'absolute', top: 6, right: 6, backgroundColor: theme.ink, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
          <Text style={{ color: '#fff', fontSize: 10 }}>לא זמין</Text>
        </View>
      )}
      {showName && <Text numberOfLines={2} style={[text(12, '500'), { marginTop: 6 }]}>{item.name}</Text>}
      {caption ? <Text style={text(11, '400', theme.muted)}>{caption}</Text> : null}
    </View>
  );
}
