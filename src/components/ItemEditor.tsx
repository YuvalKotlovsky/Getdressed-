import React, { useEffect, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { COLORS, theme } from '../theme';
import { categoryLabel, dressinessLabel, occasionLabel, partLabel } from '../i18n';
import { rowDir, text } from '../ui';
import { Chip } from './Chip';
import { Btn } from './OutfitCard';
import { defaultsFor, manualTagger } from '../tagging/tagger';
import { persistPhoto } from '../storage/persist';
import { useApp } from '../state/AppContext';
import type { Category, Dressiness, Item, Occasion, Part } from '../types';

const CATS = Object.keys(categoryLabel) as Category[];
const OCCS: Occasion[] = ['work', 'workout', 'casual', 'evening'];

const blank = (): Item => ({ id: `u-${Date.now()}`, name: '', category: 'top', available: true, color: 'white', ...defaultsFor('top') });

export function ItemEditor({ item, visible, onClose }: { item: Item | null; visible: boolean; onClose: () => void }) {
  const { saveItem, deleteItem } = useApp();
  const [it, setIt] = useState<Item>(blank());
  const isNew = !item;
  useEffect(() => { if (visible) setIt(item ? { ...item } : blank()); }, [visible, item]);
  const set = (p: Partial<Item>) => setIt((x) => ({ ...x, ...p }));

  const pick = async (camera: boolean) => {
    try {
      const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('אין הרשאה', 'אפשר להמשיך בלי תמונה ולתייג ידנית.'); return; }
      const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, allowsEditing: true };
      const res = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
      if (res.canceled || !res.assets[0]) return;
      const stored = await persistPhoto(res.assets[0].uri);
      const s = await manualTagger.suggest(stored); // no suggestions yet; recognition plugs in here
      set({ photoUri: stored, ...s });
    } catch {
      Alert.alert('לא הצלחנו לטעון את התמונה', 'אפשר לתייג ידנית ולנסות שוב.');
    }
  };

  const setCategory = (c: Category) => {
    const d = defaultsFor(c);
    set({ category: c, part: d.part, dressiness: isNew ? d.dressiness : it.dressiness, occasions: isNew ? d.occasions : it.occasions });
  };
  const toggleOcc = (o: Occasion) => set({ occasions: it.occasions.includes(o) ? it.occasions.filter((x) => x !== o) : [...it.occasions, o] });

  const save = () => {
    if (!it.name.trim()) { Alert.alert('חסר שם', 'תנו לפריט שם קצר.'); return; }
    saveItem({ ...it, name: it.name.trim() });
    onClose();
  };
  const remove = () => { deleteItem(it.id); onClose(); };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 50, paddingBottom: 40 }}>
          <Text style={text(24, '700')}>{isNew ? 'פריט חדש' : 'עריכת פריט'}</Text>

          <View style={{ alignItems: 'center', marginVertical: 16 }}>
            <View style={{ width: 180, height: 216, borderRadius: 20, backgroundColor: theme.accentSoft, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
              {it.photoUri ? <Image source={{ uri: it.photoUri }} style={{ width: '100%', height: '100%' }} /> : <Text style={{ color: theme.muted }}>ללא תמונה</Text>}
            </View>
            <View style={{ flexDirection: rowDir, gap: 10, marginTop: 12 }}>
              <Btn label="מהגלריה" kind="ghost" onPress={() => pick(false)} />
              <Btn label="צילום" kind="ghost" onPress={() => pick(true)} />
            </View>
            <Text style={[text(12, '400', theme.muted), { marginTop: 6 }]}>התמונה נשמרת במכשיר בלבד. זיהוי אוטומטי יתווסף בהמשך — בינתיים מתייגים ידנית.</Text>
          </View>

          <Text style={text(14, '600', theme.muted)}>שם</Text>
          <TextInput value={it.name} onChangeText={(v) => set({ name: v })} placeholder="לדוגמה: חולצת פשתן לבנה" placeholderTextColor={theme.muted}
            style={[text(16), { backgroundColor: '#fff', borderRadius: 12, padding: 12, marginTop: 6, marginBottom: 14 }]} />

          <Text style={text(14, '600', theme.muted)}>קטגוריה</Text>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
            {CATS.map((c) => <Chip key={c} label={categoryLabel[c]} on={it.category === c} onPress={() => setCategory(c)} />)}
          </View>

          {it.category === 'activewear' && (
            <>
              <Text style={text(14, '600', theme.muted)}>סוג בגד ספורט</Text>
              <View style={{ flexDirection: rowDir, gap: 8, marginVertical: 8 }}>
                {(['top', 'bottom'] as Part[]).map((p) => <Chip key={p} label={partLabel[p]} on={it.part === p} onPress={() => set({ part: p })} />)}
              </View>
            </>
          )}

          <Text style={text(14, '600', theme.muted)}>צבע עיקרי</Text>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
            {Object.entries(COLORS).map(([k, c]) => <Chip key={k} label={c.label} swatch={c.hex} on={it.color === k} onPress={() => set({ color: k })} />)}
          </View>

          <Text style={text(14, '600', theme.muted)}>רמת רשמיות</Text>
          <View style={{ flexDirection: rowDir, gap: 8, marginVertical: 8 }}>
            {([1, 2, 3] as Dressiness[]).map((d) => <Chip key={d} label={dressinessLabel[d]} on={it.dressiness === d} onPress={() => set({ dressiness: d })} />)}
          </View>

          <Text style={text(14, '600', theme.muted)}>מתאים ל־</Text>
          <View style={{ flexDirection: rowDir, flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
            {OCCS.map((o) => <Chip key={o} label={occasionLabel[o]} on={it.occasions.includes(o)} onPress={() => toggleOcc(o)} />)}
          </View>

          <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <Text style={text(16, '500')}>זמין (לא בכביסה / תיקון)</Text>
            <Switch value={it.available} onValueChange={(v) => set({ available: v })} trackColor={{ true: theme.accent }} />
          </View>
          <View style={{ flexDirection: rowDir, justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <Text style={text(16, '500')}>מועדף</Text>
            <Switch value={!!it.favorite} onValueChange={(v) => set({ favorite: v })} trackColor={{ true: theme.accent }} />
          </View>

          <View style={{ flexDirection: rowDir, gap: 10, marginTop: 24 }}>
            <Btn label="ביטול" kind="ghost" onPress={onClose} />
            <Btn label="שמירה" onPress={save} />
          </View>
          {!isNew && (
            <Pressable onPress={remove} style={{ marginTop: 18, alignItems: 'center' }}>
              <Text style={text(15, '600', theme.warn)}>הסרת הפריט מהארון</Text>
            </Pressable>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
