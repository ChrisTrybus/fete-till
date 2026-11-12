import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { GiftAidPrompt } from '@/components/gift-aid';
import { Body, Button, Card, Heading, Label, s, useTheme } from '@/components/ui';
import { groupByCategory, tileColours } from '@/lib/categories';
import { saleFeedback, tapFeedback } from '@/lib/haptics';
import { CASH_BUTTONS, cashLabel, formatPence } from '@/lib/money';
import { useStore } from '@/lib/store';
import { openSumup, sumupAvailable } from '@/lib/sumup-open';
import { soldOnTill } from '@/lib/tills';
import type { Item, Sale, SaleLine } from '@/lib/types';

const KEEP_AWAKE_TAG = 'till';

export default function Till() {
  const t = useTheme();
  const {
    items,
    recordSale,
    session,
    isOrganiser,
    outOfStock,
    setOutOfStock,
    sales,
    cardMode,
    pendingCard,
    cardResult,
    beginCardPayment,
    settlePendingCard,
    clearCardResult,
  } = useStore();
  // Card payments go through the SumUp app when this phone is set up for it; otherwise the Card button just records the sale.
  const viaSumup = cardMode === 'sumup' && sumupAvailable;
  // What this till sells. Anything it has run out of is tucked away below the rest.
  const tillName = session?.tillName ?? '';
  const mine = useMemo(() => items.filter((i) => soldOnTill(i, tillName)), [items, tillName]);
  const inStock = useMemo(() => mine.filter((i) => !outOfStock.includes(i.id)), [mine, outOfStock]);
  const soldOut = mine.filter((i) => outOfStock.includes(i.id));
  const [showSoldOut, setShowSoldOut] = useState(false);
  // Worked out over everything this till sells, so a tile keeps its colour when stock changes.
  const colours = useMemo(() => tileColours(mine), [mine]);
  const groups = useMemo(() => groupByCategory(inStock), [inStock]);
  const closed = Boolean(session?.closedAt);
  const { width, height } = useWindowDimensions();
  const wide = width >= 760; // tablets: items left, sale panel right
  const narrow = width < 380; // small phones (iPhone SE, older Androids)
  // Phones get tighter tiles and a tighter sale panel so six or more items fit above it.
  const compact = !wide;
  // Pin the sale panel when the window is tall enough to hold it; otherwise the whole
  // screen scrolls as one (very short windows only).
  const pinned = height >= 600;

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
  // A sale with a donation in it, whose donor is being asked about Gift Aid.
  const [giftAidFor, setGiftAidFor] = useState<Sale | null>(null);

  const lines: SaleLine[] = useMemo(
    () =>
      Object.entries(cart).flatMap(([itemId, qty]) => {
        const it = inStock.find((i) => i.id === itemId);
        return it && qty > 0 ? [{ itemId, name: it.name, price: it.price, qty, ...(it.donation ? { donation: true } : {}) }] : [];
      }),
    [cart, inStock],
  );
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);
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
  // Holding a tile marks the item as run out, or brings it back.
  const setStock = (it: Item, out: boolean) => {
    saleFeedback();
    setOutOfStock(it.id, out);
    if (out) setCart(({ [it.id]: _gone, ...rest }) => rest);
    setLastMessage(out ? `${it.name} is out of stock, so it’s hidden.` : `${it.name} is back in stock.`);
  };
  // A SumUp payment has finished: on success the sale is already recorded, so clear the
  // cart; on failure keep it, to try again or take cash instead.
  useEffect(() => {
    if (!cardResult) return;
    // The result comes from outside the app (SumUp, through the return link), and is handled once, then cleared.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastMessage(cardResult.message);
    const sale = cardResult.ok ? sales[cardResult.id] : undefined;
    if (sale) {
      saleFeedback();
      setCart({});
      setTendered(0);
      if (sale.lines.some((l) => l.donation)) setGiftAidFor(sale);
    }
    clearCardResult();
  }, [cardResult, sales, clearCardResult]);

  const payBySumup = async () => {
    const pending = beginCardPayment(lines);
    try {
      await openSumup({ id: pending.id, total: pending.total, title: [session?.eventName, session?.tillName].filter(Boolean).join(' · ') });
    } catch (e) {
      // SumUp never opened, so nothing can have been charged.
      settlePendingCard(false);
      clearCardResult();
      setLastMessage(e instanceof Error ? e.message : 'Couldn’t open the SumUp app.');
    }
  };

  const complete = (method: 'cash' | 'card') => {
    if (method === 'card' && viaSumup) {
      void payBySumup();
      return;
    }
    const sale = recordSale(lines, method, tendered);
    saleFeedback();
    setLastMessage(method === 'cash' ? `Saved. Give ${formatPence(change)} change.` : `Card sale saved: ${formatPence(total)}.`);
    clear();
    // The sale is saved first, so asking about Gift Aid never holds up the money.
    if (lines.some((l) => l.donation)) setGiftAidFor(sale);
  };
  const giftAidDone = (message: string | null) => {
    if (message) {
      saleFeedback();
      setLastMessage(message);
    }
    setGiftAidFor(null);
  };
  const giftAidPrompt = (
    <>
      <GiftAidPrompt sale={giftAidFor} onDone={giftAidDone} />
      <PendingCardPrompt />
    </>
  );

  const tile = (it: Item) => {
        const out = outOfStock.includes(it.id);
        const qty = out ? 0 : (cart[it.id] ?? 0);
        return (
          // The tile is a plain View holding two sibling buttons (add, and one less),
          // so screen readers see both rather than one nested inside the other.
          <View
            key={it.id}
            style={{
              width: wide ? 150 : '48%',
              flexGrow: wide ? 0 : 1,
              minHeight: compact ? 64 : 92,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.line,
              backgroundColor: t.surface,
              borderTopWidth: 5,
              borderTopColor: out ? t.line : t.tiles[colours.get(it.id) ?? 'red'],
              opacity: out ? 0.55 : 1,
              overflow: 'hidden',
            }}
          >
            <Pressable
              onPress={() => (out ? setLastMessage(`${it.name} is out of stock. Hold it to bring it back.`) : add(it.id, 1))}
              onLongPress={() => setStock(it, !out)}
              accessibilityRole="button"
              accessibilityLabel={out ? `${it.name}, out of stock` : `Add ${it.name}, ${formatPence(it.price)}${qty ? `, ${qty} in this sale` : ''}`}
              accessibilityHint={out ? 'Hold to bring back into stock' : 'Hold to mark as out of stock'}
              accessibilityActions={[{ name: 'longpress', label: out ? 'Bring back into stock' : 'Mark as out of stock' }]}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'longpress') setStock(it, !out);
              }}
              style={({ pressed }) => ({
                flex: 1,
                paddingHorizontal: compact ? 10 : 12,
                paddingVertical: compact ? 5 : 12,
                gap: 2,
                justifyContent: 'space-between',
                backgroundColor: pressed ? t.bg : t.surface,
              })}
            >
              <Text numberOfLines={2} style={{ color: t.ink, fontSize: compact ? 15 : 16, fontWeight: '700' }}>
                {it.name}
              </Text>
              {out ? (
                <Text style={{ color: t.muted, fontSize: 14, lineHeight: 28, fontWeight: '700' }}>Out of stock</Text>
              ) : (
                <Text style={[s.num, { color: t.ink, fontSize: compact ? 18 : 20, lineHeight: 28, fontWeight: '800' }]}>{formatPence(it.price)}</Text>
              )}
            </Pressable>
            {qty > 0 && (
              <View style={{ position: 'absolute', right: compact ? 6 : 10, bottom: compact ? 4 : 10, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable
                  onPress={() => add(it.id, -1)}
                  accessibilityRole="button"
                  accessibilityLabel={`One less ${it.name}`}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    borderWidth: 1,
                    borderColor: t.line,
                    backgroundColor: pressed ? t.bg : t.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  })}
                >
                  <Text style={{ color: t.ink, fontSize: 18, lineHeight: 20, fontWeight: '700' }}>−</Text>
                </Pressable>
                <View style={{ backgroundColor: t.accent, borderRadius: 999, minWidth: 28, height: 28, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={[s.num, { color: t.accentInk, fontWeight: '800' }]}>{qty}</Text>
                </View>
              </View>
            )}
          </View>
        );
  };

  const tiles = { flexDirection: 'row', flexWrap: 'wrap', gap: compact ? 8 : 10 } as const;
  const grid = (
    <View style={{ gap: compact ? 10 : 14 }}>
      {items.length === 0 && <Body muted>No items yet. Add some on the Price list tab.</Body>}
      {items.length > 0 && mine.length === 0 && (
        <Body muted>
          No items are set for this till. {isOrganiser ? 'Choose them on the Price list tab.' : 'The organiser can choose them on the Price list tab.'}
        </Body>
      )}
      {groups.map((g) => (
        <View key={g.category} style={{ gap: 6 }}>
          {g.category ? <Label>{g.category}</Label> : null}
          <View style={tiles}>{g.items.map(tile)}</View>
        </View>
      ))}
      {/* Sold-out items are hidden so they can't be tapped by mistake, with a way to bring them back. */}
      {soldOut.length > 0 && (
        <View style={{ gap: 6 }}>
          <Pressable
            onPress={() => setShowSoldOut((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showSoldOut }}
            hitSlop={8}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 6 }}
          >
            <Text style={{ color: t.muted, fontSize: 14, fontWeight: '700' }}>{soldOut.length} out of stock</Text>
            <Text style={{ color: t.ink, fontSize: 14, fontWeight: '700' }}>{showSoldOut ? 'Hide' : 'Show'}</Text>
          </Pressable>
          {showSoldOut && (
            <>
              <Body muted>Hold an item to bring it back into stock.</Body>
              <View style={tiles}>{soldOut.map(tile)}</View>
            </>
          )}
        </View>
      )}
    </View>
  );

  const clearLink = lines.length > 0 && (
    <Pressable onPress={clear} accessibilityRole="button" hitSlop={10}>
      <Text style={{ color: t.muted, fontWeight: '700' }}>Clear</Text>
    </Pressable>
  );

  const saleHeader = (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Label>This sale</Label>
      {clearLink}
    </View>
  );

  const saleLines =
    lines.length === 0 ? (
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
    );

  // Everything from the total down. Its height never changes, so wherever it is
  // anchored the cash keys and the two sale buttons stay put.
  const checkout = (
    <>
      <View
        style={{
          backgroundColor: t.sun,
          borderRadius: 14,
          paddingHorizontal: 14,
          paddingVertical: compact ? 6 : 14,
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <Text style={{ color: t.sunInk, fontWeight: '800', letterSpacing: 1 }}>TOTAL</Text>
        <Text style={[s.num, { color: t.sunInk, fontSize: compact ? 30 : 38, fontWeight: '800' }]}>{formatPence(total)}</Text>
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Label>Cash handed over</Label>
        </View>
        {compact && tendered > 0 && (
          <Pressable onPress={() => setTendered(0)} accessibilityRole="button" accessibilityLabel="Reset cash" hitSlop={10}>
            <Text style={{ color: t.muted, fontWeight: '700' }}>Reset</Text>
          </Pressable>
        )}
        <Text style={[s.num, { color: t.ink, fontWeight: '700' }]}>{formatPence(tendered)}</Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {CASH_BUTTONS.map((p) => (
          <CashKey key={p} label={cashLabel(p)} compact={compact} onPress={() => setTendered((v) => v + p)} />
        ))}
        <CashKey label="Exact" compact={compact} onPress={() => setTendered(total)} />
        {!compact && <CashKey label="Reset cash" wide onPress={() => setTendered(0)} />}
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Label>Change to give</Label>
        <Text style={[s.num, { fontSize: compact ? 22 : 28, lineHeight: compact ? 26 : 34, fontWeight: '800', color: tendered && change < 0 ? t.danger : t.ink }]}>
          {!tendered ? '–' : change < 0 ? `${formatPence(-change)} short` : formatPence(change)}
        </Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={viaSumup ? 'SumUp' : 'Card'} disabled={!total || Boolean(pendingCard)} onPress={() => complete('card')} style={{ flex: 1 }} />
        <Button
          title={total && !tendered ? 'Enter cash' : 'Complete cash sale'}
          kind="primary"
          disabled={!total || change < 0}
          onPress={() => complete('cash')}
          style={{ flex: 2 }}
        />
      </View>
    </>
  );

  if (closed) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' }}>
        <Card>
          <Heading>This event is closed</Heading>
          <Body>No more sales can be taken. The figures are on the Day total tab.</Body>
          <Body muted>
            {isOrganiser ? 'Closed by mistake? You can reopen it on the Event tab.' : 'If it was closed by mistake, the organiser can reopen it.'}
          </Body>
        </Card>
        {/* A card payment can still be with SumUp when the event closes; it must still be settled. */}
        <PendingCardPrompt />
      </ScrollView>
    );
  }

  // Very short window: nothing can be pinned, so the whole screen scrolls as one.
  if (!pinned) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, flexDirection: wide ? 'row' : 'column', alignItems: 'flex-start' }}>
        <View style={{ flex: wide ? 1 : undefined, width: wide ? undefined : '100%' }}>{grid}</View>
        <View style={{ width: wide ? undefined : '100%' }}>
          <Card style={{ width: wide ? 360 : undefined }}>
            {saleHeader}
            {saleLines}
            {checkout}
          </Card>
        </View>
        {giftAidPrompt}
      </ScrollView>
    );
  }

  // Tablets: items scroll on the left; the sale panel fills the right-hand side with
  // only its list of lines scrolling, so the total, cash keys and buttons never move.
  if (wide) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', padding: 16, gap: 16 }}>
        <ScrollView style={{ flex: 1 }}>{grid}</ScrollView>
        <Card style={{ width: 360 }}>
          {saleHeader}
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12 }}>
            {saleLines}
          </ScrollView>
          {checkout}
        </Card>
        {giftAidPrompt}
      </View>
    );
  }

  // Phones: items scroll above a sale panel pinned to the bottom. Quantities live on
  // the item tiles here, so the panel keeps to one status line instead of a list.
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        {grid}
      </ScrollView>
      <View style={{ backgroundColor: t.surface, borderTopWidth: 1, borderTopColor: t.line, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, gap: 8 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, height: 20 }}>
          <Text numberOfLines={1} style={{ flex: 1, color: lines.length === 0 && lastMessage ? t.ink : t.muted, fontSize: 14, fontWeight: '700' }}>
            {lines.length > 0 ? `${count} ${count === 1 ? 'item' : 'items'} in this sale` : (lastMessage ?? 'Tap items to add them.')}
          </Text>
          {clearLink}
        </View>
        {checkout}
      </View>
      {giftAidPrompt}
    </View>
  );
}

/**
 * Covers the till while a card payment is with the SumUp app, so the same sale can't be
 * taken twice. SumUp normally brings the volunteer back and this closes by itself. If it
 * doesn't (the phone closed this app, or the volunteer came back by hand), they check
 * the SumUp app and say what happened.
 */
function PendingCardPrompt() {
  const { pendingCard, settlePendingCard } = useStore();
  const [confirmPaid, setConfirmPaid] = useState(false);
  const pending = pendingCard;
  return (
    <Modal visible={pending !== null} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 16 }}>
        {pending && (
          <Card style={{ maxWidth: 520, width: '100%', alignSelf: 'center' }}>
            <Heading>Card payment of {formatPence(pending.total)}</Heading>
            <Body>Take the card in the SumUp app. You’ll come back here when it’s done.</Body>
            <Body muted>
              If SumUp didn’t bring you back, open the SumUp app and check its sales history, then say whether this payment went
              through.
            </Body>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                title="It wasn’t paid"
                onPress={() => {
                  setConfirmPaid(false);
                  settlePendingCard(false);
                }}
                style={{ flex: 1 }}
              />
              <Button
                title={confirmPaid ? 'Tap again to record' : 'It was paid'}
                kind="primary"
                onPress={() => {
                  if (!confirmPaid) return setConfirmPaid(true);
                  setConfirmPaid(false);
                  settlePendingCard(true);
                }}
                style={{ flex: 1 }}
              />
            </View>
          </Card>
        )}
      </View>
    </Modal>
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

function CashKey({ label, onPress, wide, compact }: { label: string; onPress: () => void; wide?: boolean; compact?: boolean }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexBasis: wide ? '100%' : '23%',
        flexGrow: 1,
        paddingVertical: compact ? 9 : 12,
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
