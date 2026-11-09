import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { newUuid } from '../cloud/uuid';
import { COLORS, theme } from '../theme';
import { categoryLabel } from '../i18n';
import { cardStyle, rowDir, text } from '../ui';
import { Btn } from './Btn';
import { Chip } from './Chip';
import { useApp } from '../state/AppContext';
import { candidateUrl, classifyMatch, parseReceiptText, receiptFingerprint, type LineMatch, type ReceiptLine } from '../import/receipt';
import { extractReceiptViaServer, fetchProductViaServer, serverConfigured, storeFromUrl } from '../import/serverClient';
import { defaultsFor } from '../tagging/tagger';
import { persistPhoto, photoFromBase64 } from '../storage/persist';
import type { Category, Item } from '../types';

interface Row { line: ReceiptLine; match: LineMatch; include: boolean; name: string; category?: Category; color?: string; link: string; photoUri?: string; inCloset: boolean }
const CATS = Object.keys(categoryLabel).filter((c) => c !== 'activewear' || true) as Category[];
const STATUS: Record<LineMatch['status'], { label: string; border: string; style: 'solid' | 'dashed' }> = {
  matched: { label: '✓ תואם', border: theme.ink, style: 'solid' },
  uncertain: { label: '؟ לא בטוח', border: theme.accent, style: 'dashed' },
  unmatched: { label: '✕ לא נמצא', border: theme.warn, style: 'dashed' },
};

/** סריקת קבלה: text on-device (paste Live Text) or cropped photo via the server -> reviewable lines -> save items only. */
export function ReceiptImport({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { data, saveItem, settings, updateSettings } = useApp();
  const [step, setStep] = useState<'input' | 'review' | 'done'>('input');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [store, setStore] = useState<string | undefined>();
  const [fp, setFp] = useState('');
  const [dup, setDup] = useState(false);
  const [cropped, setCropped] = useState(false);
  const [saved, setSaved] = useState(0);

  useEffect(() => { if (visible) { setStep('input'); setPaste(''); setBusy(''); setErr(''); setRows([]); setDup(false); setCropped(false); setSaved(0); } }, [visible]);

  const buildRows = async (lines: ReceiptLine[], st?: string) => {
    setStep('review');
    setStore(st);
    const fingerprint = receiptFingerprint(lines);
    setFp(fingerprint);
    setDup((settings.receiptFingerprints ?? []).includes(fingerprint));
    const out: Row[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setBusy(`מתאים שורה ${i + 1} מתוך ${lines.length}…`);
      const url = serverConfigured && i < 12 ? candidateUrl(line, st) : undefined;
      let page = null as any;
      if (url) { try { page = await fetchProductViaServer(url); } catch { page = null; } }
      const match = classifyMatch(line, page);
      const inCloset = !!line.reference && data.items.some((it) => it.source?.reference === line.reference);
      out.push({ line, match, include: match.status !== 'unmatched' && !inCloset, name: match.suggestion.name, category: match.suggestion.category, color: match.suggestion.color, link: match.url ?? '', inCloset });
    }
    setRows(out);
    setBusy('');
  };

  const fromText = async () => {
    setErr('');
    const r = parseReceiptText(paste);
    if (!r.lines.length) { setErr('לא זוהו שורות פריטים בטקסט. הדביקו רק את שורות הפריטים מהקבלה.'); return; }
    await buildRows(r.lines, r.store);
  };

  const fromPhoto = async () => {
    setErr('');
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { setErr('אין הרשאה לגלריה. אפשר להדביק טקסט במקום.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
      if (res.canceled || !res.assets[0]) return;
      setBusy('קורא את הקבלה…');
      const prepared = await persistPhoto(res.assets[0].uri);
      const r = await extractReceiptViaServer(prepared.base64, prepared.mediaType);
      if (!r.lines.length) { setBusy(''); setErr('לא נקראו שורות פריטים. נסו לחתוך קרוב יותר לשורות או להדביק טקסט.'); return; }
      await buildRows(r.lines, r.store);
    } catch {
      setBusy('');
      setErr('הקריאה נכשלה או שאין חיבור לשרת. אפשר להדביק טקסט מהקבלה במקום.');
    }
  };

  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const attachLink = async (i: number) => {
    const link = rows[i].link.trim();
    if (!/^https:\/\//i.test(link)) return;
    patch(i, { match: { ...rows[i].match, note: 'בודק את הקישור…' } });
    try {
      const page = await fetchProductViaServer(link);
      const m = classifyMatch(rows[i].line, { ...page, finalUrl: page.finalUrl ?? link });
      patch(i, { match: { ...m, status: m.product ? (m.status === 'matched' ? 'matched' : 'uncertain') : rows[i].match.status, url: page.finalUrl ?? link }, name: m.suggestion.name, category: m.suggestion.category ?? rows[i].category, color: m.suggestion.color ?? rows[i].color, include: !!m.product || rows[i].include });
    } catch { patch(i, { match: { ...rows[i].match, note: 'לא הצלחנו לקרוא את הקישור. הוא יישמר עם הפריט.', url: link } }); }
  };

  const attachPhoto = async (i: number) => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsEditing: true });
      if (res.canceled || !res.assets[0]) return;
      const p = await persistPhoto(res.assets[0].uri);
      patch(i, { photoUri: p.uri, include: true });
    } catch {}
  };

  const chosen = rows.filter((r) => r.include);
  const saveAll = async () => {
    setBusy('שומר…');
    let n = 0;
    for (const r of chosen) {
      let photoUri = r.photoUri;
      if (!photoUri && r.match.imageBase64) photoUri = (await photoFromBase64(r.match.imageBase64, r.match.mediaType).catch(() => undefined))?.uri;
      const cat: Category = r.category ?? 'top';
      const d = defaultsFor(cat);
      const item: Item = {
        id: newUuid(), name: r.name.trim() || r.line.description || 'פריט מקבלה', category: cat, part: r.match.suggestion.part ?? d.part,
        subtype: r.match.suggestion.subtype, color: r.color ?? 'white', dressiness: d.dressiness, occasions: d.occasions, available: true, photoUri,
        // only the item's own origin is kept; the receipt text, prices and totals are discarded
        source: { store: store ?? storeFromUrl(r.link), url: r.link || undefined, reference: r.line.reference },
      };
      saveItem(item);
      n++;
    }
    updateSettings({ receiptFingerprints: [...new Set([...(settings.receiptFingerprints ?? []), fp])].slice(-50) });
    setSaved(n); setBusy(''); setStep('done');
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 48, paddingBottom: 40, maxWidth: 560, alignSelf: 'center', width: '100%' }}>
          <Text style={text(24, '700')}>סריקת קבלה</Text>

          {step === 'input' && (
            <>
              <Text style={[text(14, '400', theme.muted), { marginTop: 8 }]}>אנחנו שומרים רק את הפריטים שאישרתם. הקבלה עצמה לא נשמרת בארון.</Text>
              <View style={[cardStyle, { padding: 14, marginTop: 16 }]}>
                <Text style={text(15, '700')}>הדבקת טקסט מהקבלה (הכי פרטי)</Text>
                <Text style={[text(12, '400', theme.muted), { marginTop: 4 }]}>ב־iPhone: פתחו את תמונת הקבלה, לחצו לחיצה ארוכה על הטקסט ← העתקה, והדביקו כאן. הקריאה נעשית במכשיר ושום דבר לא נשלח.</Text>
                <TextInput value={paste} onChangeText={setPaste} multiline placeholder={'CAMISA POPLIN 1 2183/151/250 159.90'} placeholderTextColor={theme.muted}
                  style={[text(14), { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 10, minHeight: 110, borderWidth: 1, borderColor: theme.line, writingDirection: 'ltr', textAlign: 'left' }]} />
                <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn label="ניתוח הטקסט" disabled={!paste.trim() || !!busy} onPress={fromText} /></View>
              </View>

              <View style={[cardStyle, { padding: 14, marginTop: 14 }]}>
                <Text style={text(15, '700')}>צילום או צילום מסך של קבלה</Text>
                {serverConfigured ? (
                  <>
                    <Text style={[text(12, '400', theme.muted), { marginTop: 4 }]}>
                      אם תמשיכו, התמונה שחתכתם תישלח לשרת האפליקציה ולשירות בינה מלאכותית כדי לקרוא את שורות הפריטים. לא נשמר דבר בשרת. חתכו החוצה פרטי תשלום, פרטים אישיים וברקודים לפני השליחה (במסך החיתוך שנפתח אחרי הבחירה).
                    </Text>
                    <View style={{ flexDirection: rowDir, marginTop: 10 }}><Chip label={cropped ? 'חתכתי החוצה פרטי תשלום, פרטים אישיים וברקוד' : 'אני מאשר/ת: אחתוך החוצה פרטי תשלום, פרטים אישיים וברקוד'} on={cropped} onPress={() => setCropped((v) => !v)} /></View>
                    <View style={{ flexDirection: 'row', marginTop: 10 }}><Btn label="בחירת תמונה ושליחה" disabled={!cropped || !!busy} onPress={fromPhoto} /></View>
                  </>
                ) : (
                  <Text style={[text(12, '500', theme.warn), { marginTop: 6 }]}>קריאת תמונה דורשת שרת, והוא לא מוגדר בגרסה הזו. אפשר להדביק טקסט למעלה.</Text>
                )}
              </View>
              {err !== '' && <Text style={[text(13, '600', theme.warn), { marginTop: 12 }]}>{err}</Text>}
              {busy !== '' && <Text style={[text(13, '500', theme.muted), { marginTop: 12 }]}>{busy}</Text>}
              <View style={{ flexDirection: 'row', marginTop: 18 }}><Btn label="ביטול" kind="ghost" onPress={onClose} /></View>
            </>
          )}

          {step === 'review' && (
            <>
              <Text style={[text(13, '400', theme.muted), { marginTop: 6 }]}>
                {store === 'zara' ? 'זוהתה קבלה של Zara. ' : ''}מימין השורה המקורית, משמאל ההצעה. בדקו מוצר, צבע וווריאנט, ותקנו או דלגו.
              </Text>
              {dup && (
                <View style={{ backgroundColor: theme.warnSoft, borderRadius: 10, padding: 12, marginTop: 12 }}>
                  <Text style={text(13, '700', theme.warn)}>נראה שכבר סרקתם את הקבלה הזו</Text>
                  <Text style={[text(12, '400', theme.warn), { marginTop: 2 }]}>אפשר להמשיך, אבל כדאי לוודא שלא תתווספו פריטים כפולים.</Text>
                </View>
              )}
              {busy !== '' && <Text style={[text(13, '500', theme.muted), { marginTop: 12 }]}>{busy}</Text>}
              {rows.map((r, i) => {
                const st = STATUS[r.match.status];
                return (
                  <View key={r.line.id} style={[cardStyle, { padding: 14, marginTop: 14, borderColor: st.border, borderStyle: st.style, borderWidth: 1.5, opacity: r.include ? 1 : 0.55 }]}>
                    <View style={{ flexDirection: rowDir, justifyContent: 'space-between' }}>
                      <Text style={text(13, '700', st.border)}>{st.label}</Text>
                      {r.inCloset && <Text style={text(12, '600', theme.warn)}>כבר בארון (אותו מק״ט)</Text>}
                    </View>
                    <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]} numberOfLines={2}>מהקבלה: {'\u2066'}{r.line.raw}{'\u2069'}{r.line.quantity > 1 ? ` (כמות ${r.line.quantity}, יתווסף פריט אחד)` : ''}</Text>
                    <View style={{ flexDirection: rowDir, gap: 12, marginTop: 10, alignItems: 'center' }}>
                      <View style={{ width: 64, height: 80, borderRadius: 10, backgroundColor: theme.accentSoft, overflow: 'hidden' }}>
                        {(r.photoUri || r.match.imageBase64) && <Image source={{ uri: r.photoUri ?? `data:${r.match.mediaType ?? 'image/jpeg'};base64,${r.match.imageBase64}` }} style={{ width: '100%', height: '100%' }} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <TextInput value={r.name} onChangeText={(v) => patch(i, { name: v })} style={[text(15, '600'), { padding: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: '#fff' }]} />
                        <Text style={[text(12, '400', theme.muted), { marginTop: 4 }]}>{r.match.note}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                      {CATS.map((c) => <Chip key={c} label={categoryLabel[c]} on={r.category === c} onPress={() => patch(i, { category: c })} />)}
                    </View>
                    <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {Object.entries(COLORS).map(([k, c]) => <Chip key={k} label={c.label} swatch={c.hex} on={r.color === k} flag={!r.color} onPress={() => patch(i, { color: k })} />)}
                    </View>
                    <TextInput value={r.link} onChangeText={(v) => patch(i, { link: v })} onEndEditing={() => attachLink(i)} placeholder="קישור למוצר (אופציונלי)" placeholderTextColor={theme.muted} autoCapitalize="none"
                      style={[text(13), { marginTop: 10, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.line, backgroundColor: '#fff', writingDirection: 'ltr', textAlign: 'left' }]} />
                    <View style={{ flexDirection: rowDir, gap: 10, marginTop: 10 }}>
                      <Btn label={r.include ? 'דילוג על השורה' : 'הוספה'} kind="ghost" onPress={() => patch(i, { include: !r.include })} />
                      <Btn label="צירוף תמונה" kind="ghost" onPress={() => attachPhoto(i)} />
                    </View>
                  </View>
                );
              })}
              <View style={{ flexDirection: rowDir, gap: 10, marginTop: 20 }}>
                <Btn label="ביטול" kind="ghost" onPress={onClose} />
                <Btn label={`הוספת ${chosen.length} פריטים לארון`} disabled={!chosen.length || busy !== ''} onPress={saveAll} />
              </View>
            </>
          )}

          {step === 'done' && (
            <>
              <Text style={[text(16, '600'), { marginTop: 16 }]}>נוספו {saved} פריטים לארון.</Text>
              <Text style={[text(13, '400', theme.muted), { marginTop: 6 }]}>הם כבר זמינים להמלצות לפי התגיות שאישרתם. אפשר לשפר תגיות (רמת רשמיות, אירועים ומזג אוויר) בלחיצה על הפריט בארון. הקבלה עצמה לא נשמרה.</Text>
              <View style={{ flexDirection: 'row', marginTop: 20 }}><Btn label="סיום" onPress={onClose} /></View>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
