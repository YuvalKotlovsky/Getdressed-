import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { theme } from '../theme';
import { cardStyle, rowDir, text } from '../ui';
import { Btn } from './Btn';
import { fetchProductViaServer, serverConfigured, storeFromUrl } from '../import/serverClient';
import { photoFromBase64 } from '../storage/persist';
import type { EditorInitial } from './ItemEditor';
import type { TagField } from '../tagging/schema';

const MESSAGES: Record<string, string> = {
  blocked: 'האתר חוסם קריאה אוטומטית של הדף הזה או שהפרטים לא מופיעים בו.',
  not_found: 'הדף הוסר או שהקישור לא תקין.',
  invalid_url: 'אפשר להדביק רק קישור ציבורי שמתחיל ב־https.',
  error: 'לא הצלחנו לקרוא את הדף כרגע.',
  offline: 'אין חיבור לשרת האפליקציה.',
  unconfigured: 'קריאת פרטי מוצר דורשת שרת האפליקציה, והוא לא מוגדר בגרסה הזו.',
};

/** הדבקת קישור למוצר: read public product metadata, then hand over to the normal tag editor. */
export function LinkImport({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (i: EditorInitial) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (visible) { setUrl(''); setBusy(false); setFail(null); } }, [visible]);
  const valid = /^https:\/\/[^\s]+\.[^\s]+$/i.test(url.trim());
  const keepLink = (why: string) => {
    onDone({ item: { source: { store: storeFromUrl(url.trim()), url: url.trim() } }, note: `${why} הקישור נשמר עם הפריט. אפשר להוסיף צילום מסך מהגלריה או למלא ידנית.` });
  };

  const go = async () => {
    const link = url.trim();
    setBusy(true); setFail(null);
    try {
      const r = await fetchProductViaServer(link);
      if (r.status !== 'ok' && r.status !== 'partial') { setFail(MESSAGES[r.status] ?? MESSAGES.error); setBusy(false); return; }
      const p = r.product!;
      const photo = r.imageBase64 ? await photoFromBase64(r.imageBase64, r.mediaType).catch(() => undefined) : undefined;
      const uncertain: TagField[] = ['color', 'occasions', 'dressiness', 'weather'];
      if (!p.category) uncertain.push('category');
      onDone({
        item: {
          name: p.name, category: p.category, subtype: p.subtype, part: p.part, color: p.color ?? undefined,
          source: { store: storeFromUrl(r.finalUrl ?? link), url: r.finalUrl ?? link, reference: p.reference },
        },
        photo,
        uncertain,
        note: `נקרא מהדף: ${p.name ?? 'מוצר'}${p.colorText ? ` (צבע בדף: ${p.colorText})` : ''}. אשרו את הצבע והווריאנט שקניתם לפני השמירה.${photo ? '' : ' לא נמצאה תמונה, אפשר להוסיף מהגלריה.'}`,
      });
    } catch (e) {
      setFail((e as any)?.kind === 'not_configured' ? MESSAGES.unconfigured : MESSAGES.offline);
    }
    setBusy(false);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: '#0005' }} onPress={onClose} />
      <View style={{ backgroundColor: theme.bg, padding: 20, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <Text style={text(20, '700')}>הדבקת קישור למוצר</Text>
        <Text style={[text(13, '400', theme.muted), { marginTop: 6 }]}>
          הקישור יישלח לשרת האפליקציה, שיקרא רק את פרטי המוצר הציבוריים בדף (שם, תמונה, צבע, מק״ט). לא נשלח שום דבר אחר.
        </Text>
        <TextInput value={url} onChangeText={setUrl} placeholder="https://www.zara.com/…" placeholderTextColor={theme.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url"
          style={[text(15), { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: theme.line, writingDirection: 'ltr', textAlign: 'left' }]} />
        {!serverConfigured && <Text style={[text(12, '500', theme.warn), { marginTop: 8 }]}>{MESSAGES.unconfigured}</Text>}
        {fail && (
          <View style={[cardStyle, { padding: 12, marginTop: 12, backgroundColor: theme.warnSoft, borderColor: theme.warnSoft }]}>
            <Text style={text(13, '600', theme.warn)}>{fail}</Text>
            <Pressable onPress={() => keepLink(fail)} style={{ marginTop: 8 }}><Text style={text(13, '700', theme.accent)}>שמירת הקישור והמשך (צילום מסך או ידני)</Text></Pressable>
          </View>
        )}
        <View style={{ flexDirection: rowDir, gap: 10, marginTop: 16 }}>
          <Btn label="ביטול" kind="ghost" onPress={onClose} />
          {serverConfigured ? <Btn label={busy ? 'קורא…' : 'קריאת פרטי המוצר'} disabled={!valid || busy} onPress={go} /> : <Btn label="שמירת הקישור והמשך" disabled={!valid} onPress={() => keepLink(MESSAGES.unconfigured)} />}
        </View>
      </View>
    </Modal>
  );
}
