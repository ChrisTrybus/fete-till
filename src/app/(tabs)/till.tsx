import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Body, Button, Card, Label, s, useTheme } from '@/components/ui';
import { saleFeedback, tapFeedback } from '@/lib/haptics';
import { CASH_BUTTONS, cashLabel, formatPence } from '@/lib/money';
import { useStore } from '@/lib/store';
import type { SaleLine } from '@/lib/types';

const KEEP_AWAKE_TAG = 'till';

export default function Till() {
  const t = useTheme();
  const { items, recordSale } = useStore();
  const { width } = useWindowDimensions();
  const wide = width >= 760; // tablets: items left, sale panel right
  const narrow = width < 380; // small phones (iPhone SE, older Androids)

  // Keep the screen on while the Till tab is showing, so the phone doesn't lock
  // between customers. Tabs stay mounted, so this follows focus, not mount.
  useFocusEffect(
    useCallback(() => {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
      return () => {
        deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
      };
    }, []),
  );

  const [cart, setCart] = useState<Record<string, number>>({});
  const [tendered, setTendered] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const lines: SaleLine[] = useMemo(
    () =>
      Object.entries(cart).flatMap(([itemId, qty]) => {
        const it = items.find((i) => i.id === itemId);
        return it && qty > 0 ? [{ itemId, name: it.name, price: it.price, qty }] : [];
      }),
    [cart, items],
  );
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const change = tendered - total;

  const add = (id: string, d: number) => {
    tapFeedback();
    setLastMessage(null);
    setCart((c) => {
      const q = (c[id] ?? 0) + d;
      const next = { ...c };
      if (q <= 0) delete next[id];
      else next[id] = q;
      return next;
    });
  };
  const clear = () => {
    setCart({});
    setTendered(0);
  };
  const complete = (method: 'cash' | 'card') => {
    recordSale(lines, method, tendered);
    saleFeedback();
    setLastMessage(method === 'cash' ? `Saved. Give ${formatPence(change)} change.` : `Card sale saved: ${formatPence(total)}.`);
    clear();
  };

  const grid = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.length === 0 && <Body muted>No items yet. Add some on the Price list tab.</Body>}
      {items.map((it, i) => (
        <Pressable
          key={it.id}
          onPress={() => add(it.id, 1)}
          accessibilityRole="button"
          accessibilityLabel={`Add ${it.name}, ${formatPence(it.price)}`}
          style={({ pressed }) => ({
            width: wide ? 150 : '48%',
            flexGrow: wide ? 0 : 1,
            minHeight: 92,
            padding: 12,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.surface,
            borderTopWidth: 5,
            borderTopColor: t.bunting[i % t.bunting.length],
            justifyContent: 'space-between',
            transform: [{ scale: pressed ? 0.97 : 1 }],
          })}
        >
          <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>{it.name}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[s.num, { color: t.ink, fontSize: 20, fontWeight: '800' }]}>{formatPence(it.price)}</Text>
            {cart[it.id] ? (
              <View style={{ backgroundColor: t.accent, borderRadius: 999, minWidth: 28, height: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: t.accentInk, fontWeight: '800' }}>{cart[it.id]}</Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );

  const panel = (
    <Card style={{ width: wide ? 360 : undefined }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>This sale</Label>
        {lines.length > 0 && (
          <Pressable onPress={clear} accessibilityRole="button" hitSlop={10}>
            <Text style={{ color: t.muted, fontWeight: '700' }}>Clear</Text>
          </Pressable>
        )}
      </View>

      {lines.length === 0 ? (
        <Body muted>{lastMessage ?? 'Tap items to add them.'}</Body>
      ) : (
        lines.map((l) => (
          // Narrow phones: the name gets its own row so it isn't cut down to a few letters.
          <View key={l.itemId} style={{ flexDirection: 'row', flexWrap: narrow ? 'wrap' : 'nowrap', alignItems: 'center', justifyContent: 'flex-end', gap: 8, rowGap: 4 }}>
            <Text numberOfLines={narrow ? 2 : 1} style={{ flexGrow: 1, flexShrink: 1, flexBasis: narrow ? '100%' : 0, color: t.ink, fontSize: 16 }}>{l.name}</Text>
            <Stepper label="One less" sign="−" onPress={() => add(l.itemId, -1)} />
            <Text style={[s.num, { color: t.ink, minWidth: 22, textAlign: 'center', fontWeight: '700' }]}>{l.qty}</Text>
            <Stepper label="One more" sign="+" onPress={() => add(l.itemId, 1)} />
            <Text style={[s.num, { color: t.ink, minWidth: 64, textAlign: 'right' }]}>{formatPence(l.price * l.qty)}</Text>
          </View>
        ))
      )}

      <View style={{ backgroundColor: t.sun, borderRadius: 14, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: t.sunInk, fontWeight: '800', letterSpacing: 1 }}>TOTAL</Text>
        <Text style={[s.num, { color: t.sunInk, fontSize: 38, fontWeight: '800' }]}>{formatPence(total)}</Text>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Label>Cash handed over</Label>
        <Text style={[s.num, { color: t.ink, fontWeight: '700' }]}>{formatPence(tendered)}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {CASH_BUTTONS.map((p) => (
          <CashKey key={p} label={cashLabel(p)} onPress={() => setTendered((v) => v + p)} />
        ))}
        <CashKey label="Exact" onPress={() => setTendered(total)} />
        <CashKey label="Reset cash" wide onPress={() => setTendered(0)} />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Label>Change to give</Label>
        <Text style={[s.num, { fontSize: 28, fontWeight: '800', color: tendered && change < 0 ? t.danger : t.ink }]}>
          {!tendered ? '–' : change < 0 ? `${formatPence(-change)} short` : formatPence(change)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Card" disabled={!total} onPress={() => complete('card')} style={{ flex: 1 }} />
        <Button
          title={total && !tendered ? 'Enter cash' : 'Complete cash sale'}
          kind="primary"
          disabled={!total || change < 0}
          onPress={() => complete('cash')}
          style={{ flex: 2 }}
        />
      </View>
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, flexDirection: wide ? 'row' : 'column', alignItems: 'flex-start' }}>
      <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%' }}>{grid}</View>
      <View style={{ width: wide ? undefined : '100%' }}>{panel}</View>
    </ScrollView>
  );
}

function Stepper({ sign, label, onPress }: { sign: string; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: t.ink, fontSize: 18, fontWeight: '700' }}>{sign}</Text>
    </Pressable>
  );
}

function CashKey({ label, onPress, wide }: { label: string; onPress: () => void; wide?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexBasis: wide ? '100%' : '23%',
        flexGrow: 1,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: t.line,
        backgroundColor: pressed ? t.bg : t.surface,
        alignItems: 'center',
      })}
    >
      <Text style={{ color: t.ink, fontWeight: '700', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}
