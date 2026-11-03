import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, theme } from '../theme';
import { categoryLabel, dressinessLabel, occasionLabel, partLabel, weatherLabel } from '../i18n';
import { cardStyle, rowDir, text } from '../ui';
import { Chip } from './Chip';
import { Btn } from './Btn';
import { defaultsFor } from '../tagging/tagger';
import { createRecognitionTagger, RECOGNITION_URL, RecognitionError } from '../tagging/recognition';
import type { TagField, TagSuggestion } from '../tagging/schema';
import { persistPhoto, type PreparedPhoto } from '../storage/persist';
import { useApp } from '../state/AppContext';
import type { Category, Dressiness, Item, Occasion, Part, Weather } from '../types';

const CATS = Object.keys(categoryLabel) as Category[];
const OCCS: Occasion[] = ['work', 'workout', 'casual', 'evening', 'formal'];
const WEATHERS: Weather[] = ['hot', 'mild', 'cold'];
const blank = (): Item => ({ id: `u-${Date.now()}`, name: '', category: 'top', available: true, color: 'white', ...defaultsFor('top') });

type Phase = 'none' | 'consent' | 'running' | 'done' | 'failed';

const Label = ({ children, flag }: { children: string; flag?: boolean }) => (
  <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 }}>
    <Text style={text(13, '600', theme.muted)}>{children}</Text>
    {flag && <Text style={{ fontSize: 11, color: theme.warn, borderWidth: 1, borderColor: theme.warn, borderRadius: 8, paddingHorizontal: 6 }}>לבדיקה</Text>}
  </View>
);

export function ItemEditor({ item, visible, onClose }: { item: Item | null; visible: boolean; onClose: () => void }) {
  const { saveItem, deleteItem } = useApp();
  const [it, setIt] = useState<Item>(blank());
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [phase, setPhase] = useState<Phase>('none');
  const [uncertain, setUncertain] = useState<TagField[]>([]);
  const [note, setNote] = useState('');
  const isNew = !item;

  useEffect(() => {
    if (visible) { setIt(item ? { ...item } : blank()); setPhoto(null); setPhase('none'); setUncertain([]); setNote(''); }
  }, [visible, item]);
  const set = (p: Partial<Item>) => setIt((x) => ({ ...x, ...p }));
  const flag = (f: TagField) => uncertain.includes(f);
  const unflag = (f: TagField) => setUncertain((u) => u.filter((x) => x !== f));

  const pick = async (camera: boolean) => {
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('אין הרשאה', 'אפשר להמשיך בלי תמונה ולתייג ידנית.'); return; }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: true };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets[0]) return;
      const prepared = await persistPhoto(res.assets[0].uri);
      setPhoto(prepared);
      set({ photoUri: prepared.uri });
      setUncertain([]);
      setNote('');
      setPhase(RECOGNITION_URL ? 'consent' : 'none');
    } catch {
      Alert.alert('לא הצלחנו לטעון את התמונה', 'אפשר לתייג ידנית ולנסות שוב.');
    }
  };

  const applySuggestion = (s: TagSuggestion) => {
    const next: Partial<Item> = {};
    if (s.category) next.category = s.category;
    if (s.part) next.part = s.part;
    if (s.subtype) next.subtype = s.subtype;
    if (s.color) next.color = s.color;
    if (s.dressiness) next.dressiness = s.dressiness;
    if (s.occasions) next.occasions = s.occasions;
    if (s.weather) next.weather = s.weather;
    set(next);
    setUncertain(s.uncertain ?? []);
  };

  const analyze = async () => {
    if (!photo) return;
    setPhase('running');
    try {
      const s = await createRecognitionTagger().suggest({ base64: photo.base64, mediaType: photo.mediaType });
      applySuggestion(s);
      setPhase('done');
    } catch (e) {
      setPhase('failed');
      const kind = e instanceof RecognitionError ? e.kind : 'server';
      setNote(kind === 'not_garment' ? 'לא זוהה בגד אחד בתמונה. אפשר לצלם שוב או לתייג ידנית.' : kind === 'network' ? 'אין חיבור לשירות הזיהוי. אפשר לתייג ידנית.' : 'שירות הזיהוי לא זמין כרגע. אפשר לתייג ידנית.');
    }
  };

  const setCategory = (c: Category) => {
    const d = defaultsFor(c);
    set({ category: c, part: d.part, ...(isNew && phase !== 'done' ? { dressiness: d.dressiness, occasions: d.occasions } : {}) });
    unflag('category');
  };
  const toggleOcc = (o: Occasion) => { set({ occasions: it.occasions.includes(o) ? it.occasions.filter((x) => x !== o) : [...it.occasions, o] }); unflag('occasions'); };
  const toggleWeather = (w: Weather) => {
    const cur = it.weather ?? [];
    set({ weather: cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w] });
    unflag('weather');
  };

  const save = () => {
    const name = it.name.trim() || `${it.subtype || categoryLabel[it.category]} ${COLORS[it.color]?.label ?? ''}`.trim();
    saveItem({ ...it, name });
    onClose();
  };
  const remove = () => { deleteItem(it.id); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 40, maxWidth: 560, alignSelf: 'center', width: '100%' }}>
          <Text style={text(24, '700')}>{isNew ? 'פריט חדש' : 'עריכת פריט'}</Text>

          <View style={{ alignItems: 'center', marginVertical: 16 }}>
            <View style={{ width: 200, height: 250, borderRadius: 14, backgroundColor: theme.accentSoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.line }}>
              {it.photoUri ? <Image source={{ uri: it.photoUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Text style={text(14, '400', theme.muted)}>ללא תמונה</Text>}
            </View>
            <View style={{ flexDirection: rowDir, gap: 10, marginTop: 12, width: '100%' }}>
              <Btn label="מהגלריה" kind="ghost" onPress={() => pick(false)} />
              <Btn label="צילום" kind="ghost" onPress={() => pick(true)} />
            </View>
            <Text style={[text(12, '400', theme.muted), { marginTop: 8 }]}>
              התמונה נשמרת במכשיר בלבד. בגד אחד בכל תמונה.{RECOGNITION_URL ? '' : ' זיהוי אוטומטי לא מוגדר, מתייגים ידנית.'}
            </Text>
          </View>

          {phase === 'consent' && (
            <View style={[cardStyle, { padding: 14, marginBottom: 8 }]}>
              <Text style={text(15, '700')}>ניתוח אוטומטי של התמונה</Text>
              <Text style={[text(13, '400', theme.muted), { marginTop: 6 }]}>
                אם תאשרו, התמונה שבחרתם (מוקטנת) תישלח לשרת הזיהוי של האפליקציה, שמעביר אותה לשירות בינה מלאכותית כדי להציע תגיות. לא נשלחים שם, מיקום או נתונים אחרים, והתמונה לא נשמרת בשרת. בלי אישור לא נשלח דבר ואפשר לתייג ידנית.
              </Text>
              <View style={{ flexDirection: rowDir, gap: 10, marginTop: 12 }}>
                <Btn label="דילוג, תיוג ידני" kind="ghost" onPress={() => setPhase('none')} />
                <Btn label="שליחה וניתוח" onPress={analyze} />
              </View>
            </View>
          )}
          {phase === 'running' && <Text style={[text(14, '500', theme.muted), { marginBottom: 8 }]}>מנתחים את התמונה…</Text>}
          {phase === 'failed' && (
            <View style={{ backgroundColor: theme.warnSoft, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <Text style={text(13, '600', theme.warn)}>{note}</Text>
              <Pressable onPress={analyze} style={{ marginTop: 6 }}><Text style={text(13, '600', theme.accent)}>ניסיון נוסף</Text></Pressable>
            </View>
          )}
          {phase === 'done' && (
            <View style={[cardStyle, { padding: 14, marginBottom: 8 }]}>
              <Text style={text(14, '700')}>הצעת תיוג: {it.subtype || categoryLabel[it.category]}{it.occasions.length ? ` · ${it.occasions.map((o) => occasionLabel[o]).join(', ')}` : ''}</Text>
              <Text style={[text(12, '400', theme.muted), { marginTop: 4 }]}>
                {uncertain.length ? 'שדות המסומנים "לבדיקה" לא היו ברורים. אפשר לתקן אותם או לשמור כמו שהם.' : 'אפשר לשמור כמו שהוא או לתקן שדות בודדים למטה.'}
              </Text>
              <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn label="שמירה עם התגיות המוצעות" onPress={save} /></View>
            </View>
          )}

          <Label>שם (אופציונלי, יוצע אוטומטית)</Label>
          <TextInput value={it.name} onChangeText={(v) => set({ name: v })} placeholder="לדוגמה: חולצת פשתן לבנה" placeholderTextColor={theme.muted}
            style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.line }]} />

          <Label flag={flag('category')}>קטגוריה</Label>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
            {CATS.map((c) => <Chip key={c} label={categoryLabel[c]} on={it.category === c} flag={flag('category')} onPress={() => setCategory(c)} />)}
          </View>

          <Label flag={flag('subtype')}>סוג הבגד (לדוגמה: טייץ ספורט, ז׳קט)</Label>
          <TextInput value={it.subtype ?? ''} onChangeText={(v) => { set({ subtype: v }); unflag('subtype'); }} placeholder="סוג" placeholderTextColor={theme.muted}
            style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: flag('subtype') ? theme.warn : theme.line }]} />

          {it.category === 'activewear' && (
            <>
              <Label>חלק בלוק</Label>
              <View style={{ flexDirection: rowDir, gap: 8 }}>
                {(['top', 'bottom'] as Part[]).map((p) => <Chip key={p} label={partLabel[p]} on={it.part === p} onPress={() => set({ part: p })} />)}
              </View>
            </>
          )}

          <Label flag={flag('color')}>צבע עיקרי</Label>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(COLORS).map(([k, c]) => <Chip key={k} label={c.label} swatch={c.hex} on={it.color === k} flag={flag('color')} onPress={() => { set({ color: k }); unflag('color'); }} />)}
          </View>

          <Label flag={flag('dressiness')}>רמת רשמיות</Label>
          <View style={{ flexDirection: rowDir, gap: 8 }}>
            {([1, 2, 3] as Dressiness[]).map((d) => <Chip key={d} label={dressinessLabel[d]} on={it.dressiness === d} flag={flag('dressiness')} onPress={() => { set({ dressiness: d }); unflag('dressiness'); }} />)}
          </View>

          <Label flag={flag('occasions')}>מתאים ל־</Label>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
            {OCCS.map((o) => <Chip key={o} label={occasionLabel[o]} on={it.occasions.includes(o)} flag={flag('occasions')} onPress={() => toggleOcc(o)} />)}
          </View>

          <Label flag={flag('weather')}>מזג אוויר מתאים</Label>
          <View style={{ flexDirection: rowDir, gap: 8 }}>
            {WEATHERS.map((w) => <Chip key={w} label={weatherLabel[w]} on={(it.weather ?? []).includes(w)} flag={flag('weather')} onPress={() => toggleWeather(w)} />)}
          </View>
          {!(it.weather && it.weather.length) && <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]}>ללא בחירה: הפריט נחשב מתאים לכל מזג אוויר.</Text>}

          <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
            <Text style={text(15, '500')}>זמין (לא בכביסה / תיקון)</Text>
            <Switch value={it.available} onValueChange={(v) => set({ available: v })} trackColor={{ true: theme.accent }} />
          </View>
          <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <Text style={text(15, '500')}>מועדף</Text>
            <Switch value={!!it.favorite} onValueChange={(v) => set({ favorite: v })} trackColor={{ true: theme.accent }} />
          </View>

          <View style={{ flexDirection: rowDir, gap: 10, marginTop: 24 }}>
            <Btn label="ביטול" kind="ghost" onPress={onClose} />
            <Btn label="שמירה" onPress={save} />
          </View>
          {!isNew && (
            <Pressable onPress={remove} style={{ marginTop: 18, alignItems: 'center' }}>
              <Text style={text(14, '600', theme.warn)}>הסרת הפריט מהארון</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
