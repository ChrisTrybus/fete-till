import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Body, Button, Card, Field, Heading, s, useTheme } from '@/components/ui';
import { formatPence, parsePounds, parsePriceList } from '@/lib/money';
import { MAX_ITEMS, useStore } from '@/lib/store';

type Draft = { id: string; name: string; price: string };

const toDraft = (items: { id: string; name: string; price: number }[]): Draft[] =>
  items.map((i) => ({ id: i.id, name: i.name, price: (i.price / 100).toFixed(2) }));

/** Edit the shared price list. Changes are saved together so every till updates at once. */
export default function PriceList() {
  const t = useTheme();
  const { items, setItems, session, parked, discardParked, isOrganiser } = useStore();
  // A saved list the event refused (e.g. too long). It stays on this phone only until fixed.
  const refused = parked.find((p) => p.op.kind === 'items');
  // Unsaved edits on this phone. While there are none, the list shown is the shared
  // one, so edits made on another till appear straight away.
  const [edited, setEdited] = useState<Draft[] | null>(null);
  const dirty = edited !== null;
  const draft = edited ?? toDraft(items);
  const setDraft = (fn: (d: Draft[]) => Draft[]) => setEdited((d) => fn(d ?? toDraft(items)));
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const edit = (id: string, patch: Partial<Draft>) => {
    setMessage(null);
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const invalid = draft.filter((d) => !d.name.trim() || parsePounds(d.price) === null);
  const tooMany = session?.mode === 'cloud' && draft.length > MAX_ITEMS;

  const save = () => {
    setItems(draft.map((d) => ({ id: d.id, name: d.name.trim(), price: parsePounds(d.price)! })));
    setEdited(null);
    setMessage(session?.mode === 'cloud' ? 'Price list saved. Other tills will update when they have signal.' : 'Price list saved.');
  };

  const importPaste = () => {
    const { items: parsed, skipped } = parsePriceList(paste);
    if (!parsed.length) {
      setMessage('No lines matched. Use one item per line, like "Tea, 0.80".');
      return;
    }
    setEdited(parsed.map((p) => ({ id: randomUUID(), name: p.name, price: (p.price / 100).toFixed(2) })));
    setPaste('');
    setMessage(
      `${parsed.length} items loaded. Check them, then tap Save.` + (skipped.length ? ` Skipped: ${skipped.join('; ')}` : ''),
    );
  };

  // Volunteers see the shared list but can't change it. A list this phone saved
  // before, which the event then refused, can still be discarded.
  if (!isOrganiser) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
        <Card>
          <Heading>Price list</Heading>
          <Body muted>
            Only an organiser can change the price list. If you run this event, enter the organiser code on the Event tab.
          </Body>
          {refused && (
            <View style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.danger }}>
              <Body>This phone has price list changes the other tills don’t have. {refused.reason}</Body>
              <Button title="Go back to the shared list" kind="danger" onPress={() => discardParked(refused.id)} />
            </View>
          )}
          {items.length === 0 && <Body muted>No items yet.</Body>}
          {items.map((i) => (
            <View key={i.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
              <Text style={{ color: t.ink, fontSize: 16, flex: 1 }}>{i.name}</Text>
              <Text style={[s.num, { color: t.ink, fontSize: 16 }]}>{formatPence(i.price)}</Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Card>
          <Heading>Price list</Heading>
          {refused && (
            <View style={{ gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.danger }}>
              <Body>Not shared with other tills. {refused.reason}</Body>
              <Body muted>Fix the list and save again, or go back to the list the other tills have.</Body>
              <Button
                title="Discard my changes"
                kind="danger"
                onPress={() => {
                  discardParked(refused.id);
                  setEdited(null);
                  setMessage(null);
                }}
              />
            </View>
          )}
          {draft.map((d) => {
            const bad = !d.name.trim() || parsePounds(d.price) === null;
            return (
              <View key={d.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Field value={d.name} onChangeText={(name) => edit(d.id, { name })} placeholder="Item" style={{ flex: 1, minWidth: 0 }} />
                <Field
                  value={d.price}
                  onChangeText={(price) => edit(d.id, { price })}
                  keyboardType="decimal-pad"
                  accessibilityLabel={`Price of ${d.name} in pounds`}
                  style={[s.num, { width: 84, textAlign: 'right', borderColor: bad ? t.danger : t.line }]}
                />
                <Pressable
                  onPress={() => setDraft((x) => x.filter((y) => y.id !== d.id))}
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
            onPress={() => setDraft((d) => [...d, { id: randomUUID(), name: '', price: '' }])}
          />
          <Button title="Save price list" kind="primary" disabled={!dirty || invalid.length > 0 || tooMany} onPress={save} />
          {invalid.length > 0 && <Body muted>Each item needs a name and a price like 1.50.</Body>}
          {tooMany && (
            <Body muted>
              A shared price list can have up to {MAX_ITEMS} items. This one has {draft.length}.
            </Body>
          )}
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
