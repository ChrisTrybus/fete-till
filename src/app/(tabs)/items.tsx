import { randomUUID } from 'expo-crypto';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Body, Button, Card, Field, Heading, s, useTheme } from '@/components/ui';
import { formatPence, parsePounds, parsePriceList } from '@/lib/money';
import { useStore } from '@/lib/store';

type Draft = { id: string; name: string; price: string };

const toDraft = (items: { id: string; name: string; price: number }[]): Draft[] =>
  items.map((i) => ({ id: i.id, name: i.name, price: (i.price / 100).toFixed(2) }));

/** Edit the shared price list. Changes are saved together so every till updates at once. */
export default function PriceList() {
  const t = useTheme();
  const { items, setItems, session } = useStore();
  const [draft, setDraft] = useState<Draft[]>(() => toDraft(items));
  const [dirty, setDirty] = useState(false);
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  // Pick up edits made on another till, unless this phone has unsaved changes.
  useEffect(() => {
    if (!dirty) setDraft(toDraft(items));
  }, [items, dirty]);

  const edit = (id: string, patch: Partial<Draft>) => {
    setDirty(true);
    setMessage(null);
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const invalid = draft.filter((d) => !d.name.trim() || parsePounds(d.price) === null);

  const save = () => {
    setItems(draft.map((d) => ({ id: d.id, name: d.name.trim(), price: parsePounds(d.price)! })));
    setDirty(false);
    setMessage(session?.mode === 'cloud' ? 'Price list saved. Other tills will update when they have signal.' : 'Price list saved.');
  };

  const importPaste = () => {
    const { items: parsed, skipped } = parsePriceList(paste);
    if (!parsed.length) {
      setMessage('No lines matched. Use one item per line, like "Tea, 0.80".');
      return;
    }
    setDraft(parsed.map((p) => ({ id: randomUUID(), name: p.name, price: (p.price / 100).toFixed(2) })));
    setDirty(true);
    setPaste('');
    setMessage(
      `${parsed.length} items loaded. Check them, then tap Save.` + (skipped.length ? ` Skipped: ${skipped.join('; ')}` : ''),
    );
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Card>
          <Heading>Price list</Heading>
          {draft.map((d) => {
            const bad = !d.name.trim() || parsePounds(d.price) === null;
            return (
              <View key={d.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Field value={d.name} onChangeText={(name) => edit(d.id, { name })} placeholder="Item" style={{ flex: 1 }} />
                <Field
                  value={d.price}
                  onChangeText={(price) => edit(d.id, { price })}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Price of ${d.name} in pounds`}
                  style={[s.num, { width: 96, textAlign: 'right', borderColor: bad ? t.danger : t.line }]}
                />
                <Pressable
                  onPress={() => {
                    setDirty(true);
                    setDraft((x) => x.filter((y) => y.id !== d.id));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${d.name}`}
                  hitSlop={8}
                  style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: t.danger, fontSize: 24 }}>×</Text>
                </Pressable>
              </View>
            );
          })}
          <Button
            title="Add item"
            onPress={() => {
              setDirty(true);
              setDraft((d) => [...d, { id: randomUUID(), name: '', price: '' }]);
            }}
          />
          <Button title="Save price list" kind="primary" disabled={!dirty || invalid.length > 0} onPress={save} />
          {invalid.length > 0 && <Body muted>Each item needs a name and a price like 1.50.</Body>}
          {message && <Body>{message}</Body>}
        </Card>

        <Card>
          <Heading>Paste a list</Heading>
          <Body muted>One item per line, name then price. This replaces the list above until you save.</Body>
          <Field
            value={paste}
            onChangeText={setPaste}
            multiline
            placeholder={'Tombola ticket, 1\nSlice of cake, 1.50\nTea, 0.80'}
            style={{ minHeight: 120, textAlignVertical: 'top' }}
          />
          <Button title="Load pasted list" disabled={!paste.trim()} onPress={importPaste} />
          <Body muted>Example price: {formatPence(150)} is typed as 1.50</Body>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
