import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Body, Button, Card, Heading, Label, s, useTheme } from '@/components/ui';
import { formatPence } from '@/lib/money';
import { sharePdf } from '@/lib/share-pdf';
import { useStore } from '@/lib/store';
import { summaryHtml, summaryText } from '@/lib/summary';
import { salesToCsv, summarise } from '@/lib/totals';

/** End-of-day figures for every till in the event. */
export default function DayTotal() {
  const t = useTheme();
  const { sales, setVoided, session, parked, isOrganiser, deviceId } = useStore();
  // Sales the event refused: counted here, but not on the other tills.
  const notShared = useMemo(() => new Set(parked.flatMap((p) => (p.op.kind === 'sale' ? [p.op.sale.id] : []))), [parked]);
  const list = useMemo(() => Object.values(sales).sort((a, b) => b.at - a.at), [sales]);
  const totals = useMemo(() => summarise(list), [list]);
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);

  const exportCsv = () =>
    Share.share({ title: `${session?.eventName} sales`, message: salesToCsv(list) }).catch(() => {});

  const closedAt = session?.closedAt ?? null;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const summary = { eventName: session?.eventName ?? 'Event', sales: list, closedAt, notShared: notShared.size };
  const shareSummary = () =>
    Share.share({ title: `${summary.eventName}: end-of-day summary`, message: summaryText(summary) }).catch(() => {});
  const sharePdfSummary = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await sharePdf(summaryHtml(summary), `${summary.eventName}: end-of-day summary`);
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : 'Couldn’t make the PDF. Share the summary as text instead.');
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Takings" value={formatPence(totals.takings)} hero />
        <Stat label="Cash in tins" value={formatPence(totals.cash)} />
        <Stat label="Card" value={formatPence(totals.card)} />
        <Stat label="Sales" value={String(totals.count)} />
      </View>

      {closedAt !== null && (
        <Card style={{ borderColor: t.accent }}>
          <Heading>End-of-day summary</Heading>
          <Body muted>
            The event was closed at {new Date(closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Send the
            figures to your treasurer as a message or email, or as a PDF.
            {session?.mode === 'cloud' ? ' A till that had no signal adds its sales in when it reconnects, so check every till has synced first.' : ''}
          </Body>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Share summary" kind="primary" onPress={shareSummary} style={{ flex: 1 }} />
            <Button title={pdfBusy ? 'Making PDF…' : 'Share as PDF'} disabled={pdfBusy} onPress={sharePdfSummary} style={{ flex: 1 }} />
          </View>
          {pdfError && <Body>{pdfError}</Body>}
        </Card>
      )}

      {notShared.size > 0 && (
        <Card style={{ borderColor: t.danger }}>
          <Body>
            {notShared.size === 1 ? '1 sale on this phone is' : `${notShared.size} sales on this phone are`} not shared with the other
            tills, so their totals will be lower than this one. See the Event tab.
          </Body>
        </Card>
      )}

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
        {list.length > 0 && !isOrganiser && <Body muted>You can void sales taken on this phone. An organiser can void any till’s.</Body>}
        {list.map((sale) => (
          <View key={sale.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, gap: 4, opacity: sale.voided ? 0.5 : 1 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Label>
                {new Date(sale.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {sale.tillName} · {sale.method}
                {sale.voided ? ' · voided' : ''}
                {notShared.has(sale.id) ? ' · not shared' : ''}
              </Label>
              <Text style={[s.num, { color: t.ink, fontWeight: '700', textDecorationLine: sale.voided ? 'line-through' : 'none' }]}>
                {formatPence(sale.total)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: t.ink, flex: 1 }}>{sale.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</Text>
              {/* A till can void its own sales; only an organiser can void another till's. */}
              {(isOrganiser || sale.deviceId === deviceId) && (
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
              )}
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
