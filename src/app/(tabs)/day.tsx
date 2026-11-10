import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Body, Button, Card, Heading, Label, s, useTheme } from '@/components/ui';
import { formatPence } from '@/lib/money';
import { useStore } from '@/lib/store';
import { salesToCsv, summarise } from '@/lib/totals';

/** End-of-day figures for every till in the event. */
export default function DayTotal() {
  const t = useTheme();
  const { sales, setVoided, session } = useStore();
  const list = useMemo(() => Object.values(sales).sort((a, b) => b.at - a.at), [sales]);
  const totals = useMemo(() => summarise(list), [list]);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);

  const exportCsv = () =>
    Share.share({ title: `${session?.eventName} sales`, message: salesToCsv(list) }).catch(() => {});

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Takings" value={formatPence(totals.takings)} hero />
        <Stat label="Cash in tins" value={formatPence(totals.cash)} />
        <Stat label="Card" value={formatPence(totals.card)} />
        <Stat label="Sales" value={String(totals.count)} />
      </View>

      {session?.mode === 'cloud' && (
        <Card>
          <Heading>By till</Heading>
          <Body muted>Includes every till that has synced. Tills with no signal add in when they reconnect.</Body>
          <Row header cells={['Till', 'Sales', 'Takings']} />
          {totals.byTill.map((r) => (
            <Row key={r.tillName} cells={[r.tillName, String(r.count), formatPence(r.value)]} />
          ))}
        </Card>
      )}

      <Card>
        <Heading>By item</Heading>
        {totals.byItem.length === 0 ? (
          <Body muted>No sales yet. Completed sales appear here.</Body>
        ) : (
          <>
            <Row header cells={['Item', 'Sold', 'Value']} />
            {totals.byItem.map((r) => (
              <Row key={r.name} cells={[r.name, String(r.qty), formatPence(r.value)]} />
            ))}
          </>
        )}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Heading>Sales</Heading>
          <Button title="Export CSV" disabled={!list.length} onPress={exportCsv} style={{ paddingVertical: 8 }} />
        </View>
        {list.length === 0 && <Body muted>Nothing yet.</Body>}
        {list.map((sale) => (
          <View key={sale.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, gap: 4, opacity: sale.voided ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Label>
                {new Date(sale.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {sale.tillName} · {sale.method}
                {sale.voided ? ' · voided' : ''}
              </Label>
              <Text style={[s.num, { color: t.ink, fontWeight: '700', textDecorationLine: sale.voided ? 'line-through' : 'none' }]}>
                {formatPence(sale.total)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: t.ink, flex: 1 }}>{sale.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  if (sale.voided) setVoided(sale.id, false);
                  else if (confirmVoid === sale.id) {
                    setVoided(sale.id, true);
                    setConfirmVoid(null);
                  } else setConfirmVoid(sale.id);
                }}
              >
                <Text style={{ color: t.danger, fontWeight: '700' }}>
                  {sale.voided ? 'Restore' : confirmVoid === sale.id ? 'Tap to confirm void' : 'Void'}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function Stat({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexBasis: '47%', flexGrow: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: hero ? t.accent : t.line, backgroundColor: hero ? t.accent : t.surface }}>
      <Text style={{ color: hero ? t.accentInk : t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 }}>{label.toUpperCase()}</Text>
      <Text style={[s.num, { color: hero ? t.accentInk : t.ink, fontSize: 26, fontWeight: '800', marginTop: 4 }]}>{value}</Text>
    </View>
  );
}

function Row({ cells, header }: { cells: string[]; header?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line, gap: 8 }}>
      {cells.map((c, i) => (
        <Text
          key={i}
          style={[s.num, { flex: i === 0 ? 2 : 1, textAlign: i === 0 ? 'left' : 'right', color: header ? t.muted : t.ink, fontSize: header ? 12 : 15, fontWeight: header ? '700' : '400' }]}
        >
          {c}
        </Text>
      ))}
    </View>
  );
}
