import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, theme } from '../theme';
import { SUBTYPES, categoryLabel, dressinessLabel, occasionLabel, partLabel, weatherLabel } from '../i18n';
import { cardStyle, rowDir, text } from '../ui';
import { Chip } from './Chip';
import { Btn } from './Btn';
import { defaultsFor } from '../tagging/tagger';
import { checkRecognitionServer, createRecognitionTagger, RECOGNITION_URL, RecognitionError, type RecognitionStatus } from '../tagging/recognition';
import { partForCategory, type BrandGuess, type TagField, type TagSuggestion } from '../tagging/schema';
import { persistPhoto, type PreparedPhoto } from '../storage/persist';
import { useApp } from '../state/AppContext';
import type { Category, Dressiness, Item, Occasion, Part, Weather } from '../types';

const CATS = Object.keys(categoryLabel) as Category[];
const OCCS: Occasion[] = ['work', 'workout', 'casual', 'evening', 'formal'];
const WEATHERS: Weather[] = ['hot', 'mild', 'cold'];

/** What the form edits. A NEW item starts with nothing chosen: unrecognized fields stay empty until the user fills them. */
type Draft = Omit<Item, 'category' | 'part' | 'color' | 'dressiness'> & { category?: Category; part?: Part; color?: string; dressiness?: Dressiness };
const blank = (): Draft => ({ id: `u-${Date.now()}`, name: '', available: true, occasions: [] });

type Phase = 'none' | 'consent' | 'running' | 'done' | 'failed';
const FIELD_LABEL: Record<TagField, string> = { category: 'קטגוריה', subtype: 'סוג הבגד', color: 'צבע', occasions: 'אירועים', dressiness: 'רמת רשמיות', weather: 'מזג אוויר' };

const Label = ({ children, flag, required }: { children: string; flag?: boolean; required?: boolean }) => (
  <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, marginTop: 16, marginBottom: 8 }}>
    <Text style={text(13, '600', theme.muted)}>{children}</Text>
    {required && <Text style={{ fontSize: 11, color: theme.warn, borderWidth: 1, borderColor: theme.warn, borderRadius: 8, paddingHorizontal: 6 }}>חובה</Text>}
    {flag && !required && <Text style={{ fontSize: 11, color: theme.warn, borderWidth: 1, borderColor: theme.warn, borderRadius: 8, paddingHorizontal: 6 }}>לבדיקה</Text>}
  </View>
);

const STATUS_TEXT: Record<Exclude<RecognitionStatus, 'ready' | 'checking'>, string> = {
  unconfigured: 'זיהוי אוטומטי לא פעיל בגרסה הזו (לא הוגדר שרת זיהוי), ולכן שום דבר לא נשלח ולא הוצעו תגיות. מלאו את הפרטים ידנית.',
  down: 'שרת הזיהוי לא מגיב כרגע. מלאו את הפרטים ידנית, או נסו שוב מאוחר יותר.',
  nokey: 'שרת הזיהוי פועל אבל חסר בו מפתח לשירות הבינה המלאכותית, ולכן אין הצעות. מלאו את הפרטים ידנית.',
};

export interface EditorInitial { item: Partial<Item>; photo?: PreparedPhoto; uncertain?: TagField[]; note?: string }

export function ItemEditor({ item, visible, onClose, initial }: { item: Item | null; visible: boolean; onClose: () => void; initial?: EditorInitial | null }) {
  const { saveItem, deleteItem } = useApp();
  const [it, setIt] = useState<Draft>(blank());
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [phase, setPhase] = useState<Phase>('none');
  const [uncertain, setUncertain] = useState<TagField[]>([]);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<RecognitionStatus>('checking');
  const [guess, setGuess] = useState<BrandGuess | null>(null);
  const [multiple, setMultiple] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const isNew = !item;

  useEffect(() => {
    if (!visible) return;
    if (item) setIt({ ...item });
    else if (initial) setIt({ ...blank(), ...initial.item, photoUri: initial.photo?.uri ?? initial.item.photoUri });
    else setIt(blank());
    setPhoto(initial?.photo ?? null);
    setPhase('none'); setUncertain(initial?.uncertain ?? []); setNote(initial?.note ?? '');
    setGuess(null); setMultiple(false); setShowErrors(false);
    setStatus('checking');
    let live = true;
    checkRecognitionServer().then((s) => { if (live) setStatus(s); });
    return () => { live = false; };
  }, [visible, item, initial]);

  useEffect(() => { if (status !== 'ready' && status !== 'checking') setPhase((ph) => (ph === 'consent' ? 'none' : ph)); }, [status]);

  const set = (p: Partial<Draft>) => setIt((x) => ({ ...x, ...p }));
  const flag = (f: TagField) => uncertain.includes(f);
  const unflag = (f: TagField) => setUncertain((u) => u.filter((x) => x !== f));

  const pick = async (camera: boolean) => {
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('אין הרשאה', 'אפשר להמשיך בלי תמונה ולתייג ידנית.'); return; }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: true };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      const prepared = await persistPhoto(a.uri, a.width && a.height ? { width: a.width, height: a.height } : undefined);
      setPhoto(prepared);
      set({ photoUri: prepared.uri });
      setUncertain([]); setNote(''); setGuess(null); setMultiple(false);
      setPhase(status === 'ready' || status === 'checking' ? 'consent' : 'none'); // 'checking': still pinging; analysis fails gracefully if the server is down
    } catch {
      Alert.alert('לא הצלחנו לטעון את התמונה', 'אפשר לתייג ידנית ולנסות שוב.');
    }
  };

  const applySuggestion = (s: TagSuggestion) => {
    const next: Partial<Draft> = {};
    if (s.category) { next.category = s.category; next.part = s.part ?? partForCategory(s.category, s.subtype); }
    if (s.subtype) next.subtype = s.subtype;
    if (s.color) next.color = s.color;
    if (s.dressiness) next.dressiness = s.dressiness;
    if (s.occasions) next.occasions = s.occasions;
    if (s.weather) next.weather = s.weather;
    set(next);
    setUncertain(s.uncertain ?? []);
    setGuess(s.brand ?? null);
    setMultiple(!!s.multiple);
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
      setNote(kind === 'not_garment' ? 'לא זוהה בגד אחד בתמונה. אפשר לצלם שוב או למלא ידנית.' : kind === 'network' ? 'אין חיבור לשירות הזיהוי. לא הוצעו תגיות, מלאו ידנית.' : 'שירות הזיהוי נכשל או לא זמין כרגע. לא הוצעו תגיות, מלאו ידנית.');
    }
  };

  const setCategory = (c: Category) => {
    set({ category: c, part: partForCategory(c, it.subtype), subtype: it.category && it.category !== c ? undefined : it.subtype });
    unflag('category');
  };
  const toggleOcc = (o: Occasion) => { set({ occasions: it.occasions.includes(o) ? it.occasions.filter((x) => x !== o) : [...it.occasions, o] }); unflag('occasions'); };
  const toggleWeather = (w: Weather) => {
    const cur = it.weather ?? [];
    set({ weather: cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w] });
    unflag('weather');
  };

  const missing = { category: !it.category, color: !it.color };
  const save = () => {
    if (missing.category || missing.color) { setShowErrors(true); return; }
    const category = it.category!;
    const d = defaultsFor(category);
    const auto = it.brand ? `${it.brand}${it.model ? ' ' + it.model : ''} ${COLORS[it.color!]?.label ?? ''}` : `${it.subtype || categoryLabel[category]} ${COLORS[it.color!]?.label ?? ''}`;
    saveItem({
      ...it, category, color: it.color!, part: it.part ?? partForCategory(category, it.subtype),
      dressiness: it.dressiness ?? d.dressiness,
      occasions: it.occasions.length ? it.occasions : d.occasions,
      name: it.name.trim() || auto.trim(),
    });
    onClose();
  };
  const remove = () => { deleteItem(it.id); onClose(); };
  const unrecognized = (['category', 'subtype', 'color', 'occasions', 'dressiness', 'weather'] as TagField[]).filter((f) => uncertain.includes(f));

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
            <Text style={[text(12, '400', theme.muted), { marginTop: 8 }]}>התמונה נשמרת במכשיר בלבד. בגד אחד בכל תמונה, ובצילום מסך נזהה את הפריט הראשי שבחזית.</Text>
          </View>

          {isNew && status !== 'ready' && status !== 'checking' && (
            <View style={{ backgroundColor: theme.warnSoft, borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <Text style={text(13, '600', theme.warn)}>{STATUS_TEXT[status]}</Text>
            </View>
          )}
          {note !== '' && phase !== 'failed' && (
            <View style={{ backgroundColor: theme.accentSoft, borderRadius: 10, padding: 12, marginBottom: 8 }}><Text style={text(13, '500')}>{note}</Text></View>
          )}
          {it.source && (
            <Text style={[text(12, '400', theme.muted), { marginBottom: 8 }]} numberOfLines={2}>
              מקור: {it.source.store || 'קישור'}{it.source.reference ? ` · מק״ט ${it.source.reference}` : ''}{it.source.url ? ` · ${it.source.url}` : ''}
            </Text>
          )}
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
              <Text style={text(14, '700')}>הצעת תיוג: {it.category ? categoryLabel[it.category] : '—'}{it.subtype ? ` → ${it.subtype}` : ''}{it.color ? ` → ${COLORS[it.color]?.label}` : ''}</Text>
              <Text style={[text(12, '400', theme.muted), { marginTop: 4 }]}>
                {unrecognized.length ? `לא זוהו או לא ברורים: ${unrecognized.map((f) => FIELD_LABEL[f]).join(', ')}. הם מסומנים "לבדיקה" ואפשר למלא אותם ידנית.` : 'אפשר לאשר כמו שהוא או לתקן שדות בודדים למטה.'}
              </Text>
              {multiple && <Text style={[text(12, '500', theme.accent), { marginTop: 4 }]}>בתמונה יש כמה פריטים. הצענו את הפריט הראשי שבחזית.</Text>}
              {guess && !it.brand && (
                <View style={{ backgroundColor: theme.accentSoft, borderRadius: 10, padding: 10, marginTop: 10 }}>
                  <Text style={text(13, '600')}>מותג ודגם אפשריים: {guess.brand}{guess.model ? ` ${guess.model}` : ''} ({guess.source === 'caption' ? 'לפי הכיתוב בתמונה' : guess.source === 'logo' ? 'לפי לוגו' : 'לפי העיצוב, פחות בטוח'})</Text>
                  <View style={{ flexDirection: rowDir, gap: 10, marginTop: 8 }}>
                    <Btn label="לא נכון" kind="ghost" onPress={() => setGuess(null)} />
                    <Btn label="אישור" onPress={() => { set({ brand: guess.brand, model: guess.model }); setGuess(null); }} />
                  </View>
                </View>
              )}
              <View style={{ flexDirection: 'row', marginTop: 10 }}>
                <Btn label="שמירה עם התגיות המוצעות" disabled={missing.category || missing.color} onPress={save} />
              </View>
            </View>
          )}
          {it.brand && (
            <View style={{ flexDirection: rowDir, alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Text style={text(13, '600')}>מותג ודגם: {it.brand}{it.model ? ` ${it.model}` : ''}</Text>
              <Pressable onPress={() => set({ brand: undefined, model: undefined })}><Text style={text(12, '600', theme.warn)}>הסרה</Text></Pressable>
            </View>
          )}

          <Label>שם (אופציונלי, יוצע אוטומטית)</Label>
          <TextInput value={it.name} onChangeText={(v) => set({ name: v })} placeholder="לדוגמה: חולצת פשתן לבנה" placeholderTextColor={theme.muted}
            style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: theme.line }]} />

          <Label flag={flag('category')} required={showErrors && missing.category}>קטגוריה</Label>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
            {CATS.map((c) => <Chip key={c} label={categoryLabel[c]} on={it.category === c} flag={flag('category') || (showErrors && missing.category)} onPress={() => setCategory(c)} />)}
          </View>

          <Label flag={flag('subtype')}>סוג הבגד</Label>
          {it.category && (
            <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {SUBTYPES[it.category].map((s) => <Chip key={s} label={s} on={it.subtype === s} flag={flag('subtype')} onPress={() => { set({ subtype: s, part: partForCategory(it.category!, s) }); unflag('subtype'); }} />)}
            </View>
          )}
          <TextInput value={it.subtype ?? ''} onChangeText={(v) => { set({ subtype: v }); unflag('subtype'); }} placeholder="סוג (אפשר להקליד חופשי)" placeholderTextColor={theme.muted}
            style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: flag('subtype') ? theme.warn : theme.line }]} />

          {it.category === 'activewear' && (
            <>
              <Label>חלק בלוק</Label>
              <View style={{ flexDirection: rowDir, gap: 8 }}>
                {(['top', 'bottom'] as Part[]).map((p) => <Chip key={p} label={partLabel[p]} on={it.part === p} onPress={() => set({ part: p })} />)}
              </View>
            </>
          )}

          <Label flag={flag('color')} required={showErrors && missing.color}>צבע עיקרי</Label>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(COLORS).map(([k, c]) => <Chip key={k} label={c.label} swatch={c.hex} on={it.color === k} flag={flag('color') || (showErrors && missing.color)} onPress={() => { set({ color: k }); unflag('color'); }} />)}
          </View>

          <Label flag={flag('dressiness')}>רמת רשמיות</Label>
          <View style={{ flexDirection: rowDir, gap: 8 }}>
            {([1, 2, 3] as Dressiness[]).map((d) => <Chip key={d} label={dressinessLabel[d]} on={it.dressiness === d} flag={flag('dressiness')} onPress={() => { set({ dressiness: d }); unflag('dressiness'); }} />)}
          </View>

          <Label flag={flag('occasions')}>מתאים ל־</Label>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8 }}>
            {OCCS.map((o) => <Chip key={o} label={occasionLabel[o]} on={it.occasions.includes(o)} flag={flag('occasions')} onPress={() => toggleOcc(o)} />)}
          </View>
          {(!it.occasions.length || !it.dressiness) && <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]}>שדות שלא נבחרו יוגדרו אוטומטית לפי הקטגוריה בעת השמירה, ואפשר לשנות אותם בהמשך.</Text>}

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

          {showErrors && (missing.category || missing.color) && (
            <Text style={[text(13, '600', theme.warn), { marginTop: 16 }]}>כדי לשמור צריך לבחור {[missing.category && 'קטגוריה', missing.color && 'צבע'].filter(Boolean).join(' ו')}.</Text>
          )}
          <View style={{ flexDirection: rowDir, gap: 10, marginTop: 16 }}>
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
