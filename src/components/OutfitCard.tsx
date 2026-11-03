import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { theme } from '../theme';
import { occasionLabel, missingLabel, weatherLabel } from '../i18n';
import { formatTime } from '../logic/dates';
import { cardStyle, rowDir, text } from '../ui';
import { ItemTile } from './ItemTile';
import { Btn } from './Btn';
import { Chip } from './Chip';
import { useApp } from '../state/AppContext';
import type { Occasion, PlanEntry } from '../types';

const OCCASIONS: Occasion[] = ['work', 'workout', 'casual', 'evening', 'formal'];
const GAP = 10;

export function OutfitCard({ dKey, entry, isToday }: { dKey: string; entry: PlanEntry; isToday: boolean }) {
  const { nextLook, confirmLook, clearSaved, setOccasion, mode, moveDemoEvent, removeManualEvent } = useApp();
  const [rowW, setRowW] = useState(300);
  const [editing, setEditing] = useState(false);
  const { event, outfit } = entry;
  const shown = outfit.layer ? [...outfit.items, outfit.layer] : outfit.items;
  const ids = shown.map((i) => i.id);
  const cols = Math.max(3, shown.length);
  const tile = Math.floor((rowW - GAP * (cols - 1)) / cols);
  const incomplete = outfit.missing.length > 0;
  const w = entry.weather;

  return (
    <View style={[cardStyle, { padding: 16, marginBottom: 16 }]}>
      <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[text(18, '700'), { flex: 1 }]}>{event ? event.title : 'יום חופשי'}</Text>
        {event && <Text style={text(16, '600')}>{formatTime(event.start)}</Text>}
      </View>
      <Text style={[text(13, '400', theme.muted), { marginTop: 2 }]}>
        {occasionLabel[entry.occasion]} · {Math.round(w.temp)}° {weatherLabel[w.band]}
      </Text>
      <Text style={[text(15, '500'), { marginTop: 10 }]}>{outfit.reason}</Text>

      {event && !entry.confident && (
        <Text style={[text(12, '500', theme.warn), { marginTop: 6 }]}>לא בטוח לגבי סוג האירוע. אפשר לתקן בלחיצה על "שינוי סוג".</Text>
      )}

      <View onLayout={(e) => setRowW(e.nativeEvent.layout.width)} style={{ flexDirection: rowDir, gap: GAP, marginTop: 14 }}>
        {outfit.items.map((it) => <ItemTile key={it.id} item={it} size={tile} />)}
        {outfit.layer && <ItemTile item={outfit.layer} size={tile} caption={outfit.layerNeed === 'optional' ? 'שכבה · לא חובה' : 'שכבה'} />}
      </View>

      {incomplete && (
        <View style={{ backgroundColor: theme.warnSoft, borderRadius: 10, padding: 12, marginTop: 14 }}>
          <Text style={text(13, '600', theme.warn)}>חסר בארון: {outfit.missing.map((m) => missingLabel[m]).join(', ')}</Text>
          <Text style={[text(12, '400', theme.warn), { marginTop: 2 }]}>
            {outfit.items.length ? 'אלה הפריטים שכן יש לכם. אפשר להוסיף פריט בלשונית הארון.' : 'אין עדיין פריטים מתאימים. אפשר להוסיף בלשונית הארון.'}
          </Text>
        </View>
      )}
      {outfit.missingLayer && (
        <View style={{ backgroundColor: theme.warnSoft, borderRadius: 10, padding: 12, marginTop: 14 }}>
          <Text style={text(13, '600', theme.warn)}>חסרה שכבה חמה בארון</Text>
          <Text style={[text(12, '400', theme.warn), { marginTop: 2 }]}>צפוי קר ({Math.round(w.temp)}°). כדאי להוסיף מעיל או ז׳קט מתאים לאירוע הזה.</Text>
        </View>
      )}
      {outfit.stale && (
        <View style={{ backgroundColor: theme.warnSoft, borderRadius: 10, padding: 12, marginTop: 14 }}>
          <Text style={text(13, '600', theme.warn)}>הלוק השמור כבר לא זמין: {outfit.stale.join(', ')}</Text>
        </View>
      )}

      {event && editing && (
        <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
          {OCCASIONS.map((o) => <Chip key={o} label={occasionLabel[o]} on={entry.occasion === o} onPress={() => setOccasion(event.id, o)} />)}
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

      <View style={{ flexDirection: rowDir, gap: 16, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        {event && (
          <Pressable onPress={() => setEditing((v) => !v)}><Text style={text(12, '600', theme.accent)}>{editing ? 'סיום' : 'שינוי סוג'}</Text></Pressable>
        )}
        {event && mode === 'demo' && (
          <>
            <Pressable onPress={() => moveDemoEvent(event.id, 1)}><Text style={text(12, '400', theme.muted)}>הזזה ליום הבא (הדגמה)</Text></Pressable>
            <Pressable onPress={() => moveDemoEvent(event.id, -1)}><Text style={text(12, '400', theme.muted)}>הזזה ליום קודם</Text></Pressable>
          </>
        )}
        {event && mode === 'mine' && event.calendarId === 'manual' && (
          <Pressable onPress={() => removeManualEvent(event.id)}><Text style={text(12, '400', theme.warn)}>הסרת האירוע</Text></Pressable>
        )}
      </View>
    </View>
  );
}
