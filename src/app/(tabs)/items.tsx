import { randomUUID } from 'expo-crypto';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Body, Button, Card, Field, Heading, s, useTheme } from '@/components/ui';
import { categoriesOf, categoryKey, COLOURS, tileColours, type Colour } from '@/lib/categories';
import { formatPence, parsePounds, parsePriceList } from '@/lib/money';
import { MAX_ITEMS, useStore } from '@/lib/store';
import { tillKey, toggleTill, uniqueTills } from '@/lib/tills';
import type { Item } from '@/lib/types';

type Draft = { id: string; name: string; price: string; tills?: string[]; category?: string; colour?: string };

const toDraft = (items: Item[]): Draft[] =>
  items.map((i) => ({ id: i.id, name: i.name, price: (i.price / 100).toFixed(2), tills: i.tills, category: i.category, colour: i.colour }));

/** Edit the shared price list. Changes are saved together so every till updates at once. */
export default function PriceList() {
  const t = useTheme();
  const { items, setItems, session, parked, discardParked, isOrganiser, tills } = useStore();
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
  // Every till worth offering: this one, those that have joined, and any already
  // named on an item (so a till that has since left can still be unticked).
  const knownTills = uniqueTills([session?.tillName ?? '', ...tills, ...draft.flatMap((d) => d.tills ?? [])]);
  // With a single till there is nothing to choose, so the list stays as plain as ever.
  const manyTills = knownTills.length > 1;
  const [choosingTills, setChoosingTills] = useState(false);
  // Categories group the items on the till, and each has a tile colour.
  const [grouping, setGrouping] = useState(false);
  const categories = categoriesOf(draft);
  const colours = tileColours(draft);

  /** Puts an item in a category. It takes on the colour the category already has. */
  const setCategory = (id: string, name: string | undefined) => {
    setMessage(null);
    setDraft((d) => {
      const key = categoryKey(name);
      const peer = key ? d.find((x) => x.id !== id && categoryKey(x.category) === key) : undefined;
      return d.map((x) => (x.id === id ? { ...x, category: name || undefined, colour: peer ? peer.colour : x.colour } : x));
    });
  };
  /** Sets an item's tile colour, and with it the rest of its category. Undefined goes back to automatic. */
  const setColour = (id: string, colour: Colour | undefined) => {
    setMessage(null);
    setDraft((d) => {
      const key = categoryKey(d.find((x) => x.id === id)?.category);
      return d.map((x) => (x.id === id || (key && categoryKey(x.category) === key) ? { ...x, colour } : x));
    });
  };

  const edit = (id: string, patch: Partial<Draft>) => {
    setMessage(null);
    setDraft((d) => d.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const invalid = draft.filter((d) => !d.name.trim() || parsePounds(d.price) === null);
  const tooMany = session?.mode === 'cloud' && draft.length > MAX_ITEMS;

  const save = () => {
    // One spelling per category, so "Drinks" and "drinks" are saved as the same name.
    const spelling = (name: string | undefined) => categories.find((c) => categoryKey(c) === categoryKey(name));
    setItems(
      draft.map((d) => ({
        id: d.id,
        name: d.name.trim(),
        price: parsePounds(d.price)!,
        ...(d.tills?.length ? { tills: d.tills } : {}),
        ...(spelling(d.category) ? { category: spelling(d.category) } : {}),
        ...(d.colour ? { colour: d.colour } : {}),
      })),
    );
    setEdited(null);
    setMessage(session?.mode === 'cloud' ? 'Price list saved. Other tills will update when they have signal.' : 'Price list saved.');
  };

  const importPaste = () => {
    const { items: parsed, skipped } = parsePriceList(paste);
    if (!parsed.length) {
      setMessage('No lines matched. Use one item per line, like "Tea, 0.80".');
      return;
    }
    setEdited(parsed.map((p) => ({ id: randomUUID(), name: p.name, price: (p.price / 100).toFixed(2), category: p.category })));
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
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.ink, fontSize: 16 }}>{i.name}</Text>
                {i.category || i.tills?.length ? (
                  <Text style={{ color: t.muted, fontSize: 13 }}>
                    {[i.category, i.tills?.length ? `Only on ${i.tills.join(', ')}` : ''].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>
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
          {manyTills && (
            <>
              <Body muted>Every till sells every item unless you choose otherwise.</Body>
              <Button title={choosingTills ? 'Done choosing tills' : 'Choose which tills sell what'} onPress={() => setChoosingTills((v) => !v)} />
            </>
          )}
          {draft.length > 0 && (
            <>
              <Body muted>Categories such as Drinks or Cakes group the items on the till, each in its own colour.</Body>
              <Button title={grouping ? 'Done with categories' : 'Set categories and colours'} onPress={() => setGrouping((v) => !v)} />
            </>
          )}
          {draft.map((d) => {
            const bad = !d.name.trim() || parsePounds(d.price) === null;
            const on = (till: string) => Boolean(d.tills?.some((x) => tillKey(x) === tillKey(till)));
            return (
              <View key={d.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
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
              {manyTills && choosingTills ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 6 }}>
                  <Chip title="All tills" label={`${d.name}: sold on all tills`} selected={!d.tills?.length} onPress={() => edit(d.id, { tills: undefined })} />
                  {knownTills.map((till) => (
                    <Chip
                      key={tillKey(till)}
                      title={till}
                      label={`${d.name}: sold on ${till}`}
                      selected={on(till)}
                      onPress={() => edit(d.id, { tills: toggleTill(d.tills, till, knownTills) })}
                    />
                  ))}
                </View>
              ) : d.tills?.length ? (
                <Text style={{ color: t.muted, fontSize: 13, paddingBottom: 6 }}>Only on {d.tills.join(', ')}</Text>
              ) : null}
              {grouping ? (
                <View style={{ gap: 8, paddingBottom: 10 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    <Chip title="No category" label={`${d.name}: no category`} selected={!categoryKey(d.category)} onPress={() => setCategory(d.id, undefined)} />
                    {categories.map((c) => (
                      <Chip
                        key={categoryKey(c)}
                        title={c}
                        label={`${d.name}: in ${c}`}
                        selected={categoryKey(d.category) === categoryKey(c)}
                        onPress={() => setCategory(d.id, c)}
                      />
                    ))}
                  </View>
                  <Field
                    value={d.category ?? ''}
                    onChangeText={(v) => setCategory(d.id, v)}
                    placeholder="New category, e.g. Drinks"
                    accessibilityLabel={`Category of ${d.name}`}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <Chip title="Auto colour" label={`${d.name}: colour chosen automatically`} selected={!d.colour} onPress={() => setColour(d.id, undefined)} />
                    {COLOURS.map((c) => {
                      const on = d.colour === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => setColour(d.id, c)}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: on }}
                          accessibilityLabel={`${d.name}: ${c}`}
                          hitSlop={4}
                          style={{ width: 36, height: 36, borderRadius: 18, borderWidth: 2, borderColor: on ? t.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: t.tiles[c] }} />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
                  <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: t.tiles[colours.get(d.id) ?? 'red'] }} />
                  <Text style={{ color: t.muted, fontSize: 13 }}>{d.category?.trim() || 'No category'}</Text>
                </View>
              )}
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

function Chip({ title, label, selected, onPress }: { title: string; label: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      hitSlop={4}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? t.accent : t.line,
        backgroundColor: selected ? t.accent : t.surface,
      }}
    >
      <Text style={{ color: selected ? t.accentInk : t.ink, fontSize: 14, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}
