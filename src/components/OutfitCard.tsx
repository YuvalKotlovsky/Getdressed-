import React from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { theme } from '../theme';
import { occasionLabel, missingLabel } from '../i18n';
import { formatTime } from '../logic/dates';
import { rowDir, shadow, text } from '../ui';
import { ItemTile } from './ItemTile';
import { useApp } from '../state/AppContext';
import type { Occasion, PlanEntry } from '../types';

const OCCASIONS: Occasion[] = ['work', 'workout', 'casual', 'evening'];

export function Btn({ label, onPress, kind = 'solid', disabled }: { label: string; onPress: () => void; kind?: 'solid' | 'ghost'; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', opacity: disabled ? 0.4 : 1,
        backgroundColor: kind === 'solid' ? theme.accent : 'transparent',
        borderWidth: kind === 'solid' ? 0 : 1.5, borderColor: theme.accent,
      }}
    >
      <Text style={{ color: kind === 'solid' ? '#fff' : theme.accent, fontSize: 16, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

export function OutfitCard({ dKey, entry, isToday }: { dKey: string; entry: PlanEntry; isToday: boolean }) {
  const { nextLook, confirmLook, clearSaved, setOccasion, mode, moveDemoEvent, removeManualEvent } = useApp();
  const { event, outfit } = entry;
  const { width } = useWindowDimensions();
  const tile = Math.floor((Math.min(width, 560) - 40 - 36 - 12 * 2) / 3);
  const ids = outfit.items.map((i) => i.id);
  const incomplete = outfit.missing.length > 0;
  return (
    <View style={[{ backgroundColor: theme.card, borderRadius: theme.radius, padding: 18, marginBottom: 18 }, shadow]}>
      <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[text(20, '700'), { flex: 1 }]}>{event ? event.title : 'יום חופשי'}</Text>
        {event && <Text style={text(17, '600', theme.accent)}>{formatTime(event.start)}</Text>}
      </View>
      <Text style={[text(14, '400', theme.muted), { marginTop: 2 }]}>{occasionLabel[entry.occasion]}</Text>
      <Text style={[text(16, '500'), { marginTop: 8 }]}>{outfit.reason}</Text>

      {event && !entry.confident && (
        <Text style={[text(13, '500', theme.warn), { marginTop: 6 }]}>לא בטוח לגבי סוג האירוע — בחרו למטה כדי לתקן</Text>
      )}

      <View style={{ flexDirection: rowDir, gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
        {outfit.items.map((it) => <ItemTile key={it.id} item={it} size={tile} />)}
      </View>

      {incomplete && (
        <View style={{ backgroundColor: theme.warnSoft, borderRadius: 12, padding: 12, marginTop: 14 }}>
          <Text style={text(14, '600', theme.warn)}>חסר בארון: {outfit.missing.map((m) => missingLabel[m]).join(', ')}</Text>
          <Text style={[text(13, '400', theme.warn), { marginTop: 2 }]}>
            {outfit.items.length ? 'הנה הפריטים שכן יש לכם. אפשר להוסיף פריט בלשונית הארון.' : 'אין עדיין פריטים מתאימים. אפשר להוסיף בלשונית הארון.'}
          </Text>
        </View>
      )}
      {outfit.stale && (
        <View style={{ backgroundColor: theme.warnSoft, borderRadius: 12, padding: 12, marginTop: 14 }}>
          <Text style={text(14, '600', theme.warn)}>הלוק השמור כבר לא זמין: {outfit.stale.join(', ')}</Text>
        </View>
      )}

      {event && (
        <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {OCCASIONS.map((o) => (
            <Pressable key={o} onPress={() => setOccasion(event.id, o)}
              style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: entry.occasion === o ? theme.accent : theme.accentSoft }}>
              <Text style={{ color: entry.occasion === o ? '#fff' : theme.accent, fontSize: 13 }}>{occasionLabel[o]}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={{ flexDirection: rowDir, gap: 10, marginTop: 16 }}>
        {outfit.stale ? (
          <Btn label="בחירת תחליף" onPress={() => clearSaved(dKey, entry.key)} />
        ) : (
          <>
            <Btn label="לוק אחר" kind="ghost" disabled={entry.saved || outfit.options < 2} onPress={() => nextLook(dKey, entry.key)} />
            {entry.saved ? (
              <Btn label={entry.worn ? 'נלבש ✓ (ביטול)' : 'נשמר ✓ (ביטול)'} onPress={() => clearSaved(dKey, entry.key)} />
            ) : (
              <Btn label={isToday ? 'לבשתי' : 'שמירה'} disabled={ids.length === 0 || incomplete} onPress={() => confirmLook(dKey, entry.key, ids, isToday)} />
            )}
          </>
        )}
      </View>

      {event && mode === 'demo' && (
        <View style={{ flexDirection: rowDir, gap: 10, marginTop: 12, alignItems: 'center' }}>
          <Text style={text(12, '400', theme.muted)}>הדגמה: הזזת האירוע ביומן</Text>
          <Pressable onPress={() => moveDemoEvent(event.id, 1)}><Text style={text(13, '600', theme.accent)}>יום קדימה</Text></Pressable>
          <Pressable onPress={() => moveDemoEvent(event.id, -1)}><Text style={text(13, '600', theme.accent)}>יום אחורה</Text></Pressable>
        </View>
      )}
      {event && mode === 'mine' && (
        <Pressable onPress={() => removeManualEvent(event.id)} style={{ marginTop: 12 }}>
          <Text style={text(13, '600', theme.warn)}>הסרת האירוע</Text>
        </Pressable>
      )}
    </View>
  );
}
