import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Row, Stat } from '@/components/figures';
import { Body, Bunting, Button, Card, Heading, Label, s, useTheme } from '@/components/ui';
import { cashToCount } from '@/lib/floats';
import { giftAidCsv, giftAidTotals } from '@/lib/giftaid';
import { deletePastEvent, loadPastEvent } from '@/lib/history';
import { formatPence } from '@/lib/money';
import { sharePdf } from '@/lib/share-pdf';
import { summaryHtml, summaryText } from '@/lib/summary';
import { salesToCsv, summarise } from '@/lib/totals';
import type { GiftAidDeclaration, PastEvent, Sale } from '@/lib/types';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const back = () => (router.canGoBack() ? router.back() : router.replace('/history'));

/** The figures and sales of one past event, with the same exports as Day total. */
export default function PastEventScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<{ event: PastEvent; sales: Sale[]; giftAid: GiftAidDeclaration[] } | null | 'missing'>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let current = true;
    loadPastEvent(id)
      .then((found) => current && setLoaded(found ?? 'missing'))
      .catch(() => current && setLoaded('missing'));
    return () => {
      current = false;
    };
  }, [id]);

  const event = loaded && loaded !== 'missing' ? loaded.event : null;
  const list = useMemo(() => (loaded && loaded !== 'missing' ? [...loaded.sales].sort((a, b) => b.at - a.at) : []), [loaded]);
  const totals = useMemo(() => summarise(list), [list]);
  const declarations = useMemo(() => (loaded && loaded !== 'missing' ? loaded.giftAid : []), [loaded]);
  const aid = useMemo(() => giftAidTotals(list, declarations), [list, declarations]);

  if (!event) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <Bunting />
        <View style={{ padding: 16, gap: 16, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
          {loaded === 'missing' && (
            <>
              <Body>This event is no longer on this phone.</Body>
              <Button title="Back" onPress={back} />
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // If the sales can't be read, the totals saved when the event ended still can.
  const figures = list.length ? totals : event;
  const tins = cashToCount(list.length ? totals : { byTill: [], cash: event.cash }, event.floats ?? []);

  // The event is over for this phone, so the summary treats the time it left as the close.
  // Without the sales, the summary carries the saved totals rather than working out zeros.
  const summary = {
    eventName: event.name,
    sales: list,
    closedAt: event.closedAt ?? event.endedAt,
    savedTotals: list.length ? undefined : { takings: event.takings, cash: event.cash, card: event.card, count: event.count },
    floats: event.floats,
    giftAid: declarations,
  };
  const exportGiftAid = () => Share.share({ title: `${event.name} Gift Aid`, message: giftAidCsv(list, declarations) }).catch(() => {});
  const shareSummary = () => Share.share({ title: `${event.name}: end-of-day summary`, message: summaryText(summary) }).catch(() => {});
  const exportCsv = () => Share.share({ title: `${event.name} sales`, message: salesToCsv(list) }).catch(() => {});
  const sharePdfSummary = async () => {
    setPdfBusy(true);
    setError(null);
    try {
      await sharePdf(summaryHtml(summary), `${event.name}: end-of-day summary`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Couldn’t make the PDF. Share the summary as text instead.');
    } finally {
      setPdfBusy(false);
    }
  };
  const remove = async () => {
    try {
      await deletePastEvent(event.id);
      back();
    } catch {
      setError('Couldn’t delete this event. Try again.');
      setConfirmDelete(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Bunting />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Heading>{event.name}</Heading>
            <Body muted>{day(event.startedAt)}</Body>
          </View>
          <Button title="Back" onPress={back} style={{ paddingVertical: 8 }} />
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <Stat label="Takings" value={formatPence(figures.takings)} hero />
          <Stat label="Cash" value={formatPence(figures.cash)} />
          <Stat label="Card" value={formatPence(figures.card)} />
          <Stat label="Sales" value={String(figures.count)} />
        </View>

        <Card>
          <Heading>Send the figures</Heading>
          {event.mode === 'cloud' && (
            <Body muted>These are the sales this phone had when it left the event. A till that synced later is not included.</Body>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Share summary" kind="primary" onPress={shareSummary} style={{ flex: 1 }} />
            <Button title={pdfBusy ? 'Making PDF…' : 'Share as PDF'} disabled={pdfBusy} onPress={sharePdfSummary} style={{ flex: 1 }} />
          </View>
          <Button title="Export sales as CSV" disabled={!list.length} onPress={exportCsv} />
          {error && <Text style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
        </Card>

        {tins.float > 0 && (
          <Card>
            <Heading>Cash to count</Heading>
            <Body muted>
              The tins started with {formatPence(tins.float)} in floats, so they should have held {formatPence(tins.inTin)} in cash.
            </Body>
            {list.length > 0 && (
              <>
                <Row header cells={['Till', 'Float', 'Cash taken', 'In tin']} />
                {tins.rows.map((r) => (
                  <Row key={r.tillName} cells={[r.tillName, formatPence(r.float), formatPence(r.cash), formatPence(r.inTin)]} />
                ))}
              </>
            )}
          </Card>
        )}

        {(aid.donations > 0 || aid.count > 0) && (
          <Card>
            <Heading>Gift Aid</Heading>
            <Row header cells={['', 'Amount']} />
            <Row cells={['Donations taken', formatPence(aid.donations)]} />
            <Row cells={[`With a declaration (${aid.count})`, formatPence(aid.declared)]} />
            <Row cells={['Gift Aid to claim', formatPence(aid.claimable)]} />
            <Body muted>
              Keep the declarations for as long as HMRC may ask about the claim. The export holds donors’ names and addresses.
              {event.mode === 'cloud' ? ' It has the declarations this phone had when it left the event.' : ''}
            </Body>
            <Button title="Export Gift Aid declarations" disabled={!aid.count} onPress={exportGiftAid} />
          </Card>
        )}

        {totals.byTill.length > 1 && (
          <Card>
            <Heading>By till</Heading>
            <Row header cells={['Till', 'Sales', 'Takings']} />
            {totals.byTill.map((r) => (
              <Row key={r.tillName} cells={[r.tillName, String(r.count), formatPence(r.value)]} />
            ))}
          </Card>
        )}

        <Card>
          <Heading>By item</Heading>
          {totals.byItem.length === 0 ? (
            <Body muted>Nothing to show.</Body>
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
          <Heading>Sales</Heading>
          {list.length === 0 && <Body muted>The sales for this event couldn’t be read. The totals above were saved when it ended.</Body>}
          {list.map((sale) => (
            <View key={sale.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line, gap: 4, opacity: sale.voided ? 0.5 : 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Label>
                  {time(sale.at)} · {sale.tillName} · {sale.method}
                  {sale.voided ? ' · voided' : ''}
                </Label>
                <Text style={[s.num, { color: t.ink, fontWeight: '700', textDecorationLine: sale.voided ? 'line-through' : 'none' }]}>
                  {formatPence(sale.total)}
                </Text>
              </View>
              <Text style={{ color: t.ink }}>{sale.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</Text>
            </View>
          ))}
        </Card>

        <Card>
          <Label>Remove</Label>
          <Body muted>Deleting removes this event and its sales from this phone. It can’t be undone.</Body>
          <Button
            title={confirmDelete ? 'Tap again to delete' : 'Delete from this phone'}
            kind="danger"
            onPress={() => (confirmDelete ? remove() : setConfirmDelete(true))}
          />
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
