import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Row, Stat } from '@/components/figures';
import { GiftAidPrompt } from '@/components/gift-aid';
import { Body, Button, Card, Heading, Label, s, useTheme } from '@/components/ui';
import { cashToCount } from '@/lib/floats';
import { donationIn, giftAidCsv, giftAidTotals } from '@/lib/giftaid';
import { formatPence } from '@/lib/money';
import { sharePdf } from '@/lib/share-pdf';
import { useStore } from '@/lib/store';
import { summaryHtml, summaryText } from '@/lib/summary';
import { salesToCsv, summarise } from '@/lib/totals';
import type { Sale } from '@/lib/types';

/** End-of-day figures for every till in the event. */
export default function DayTotal() {
  const t = useTheme();
  const { sales, setVoided, session, parked, isOrganiser, deviceId, floats, giftAid } = useStore();
  const declarations = useMemo(() => Object.values(giftAid), [giftAid]);
  // A sale whose donor has come back to Gift Aid their donation.
  const [giftAidFor, setGiftAidFor] = useState<Sale | null>(null);
  const [giftAidMessage, setGiftAidMessage] = useState<string | null>(null);
  // Sales the event refused: counted here, but not on the other tills.
  const notShared = useMemo(() => new Set(parked.flatMap((p) => (p.op.kind === 'sale' ? [p.op.sale.id] : []))), [parked]);
  const list = useMemo(() => Object.values(sales).sort((a, b) => b.at - a.at), [sales]);
  const totals = useMemo(() => summarise(list), [list]);
  // What each tin should hold: its opening float plus the cash it took.
  const tins = useMemo(() => cashToCount(totals, floats), [totals, floats]);
  const aid = useMemo(() => giftAidTotals(list, declarations), [list, declarations]);
  const exportGiftAid = () =>
    Share.share({ title: `${session?.eventName} Gift Aid`, message: giftAidCsv(list, declarations) }).catch(() => {});
  const [confirmVoid, setConfirmVoid] = useState<string | null>(null);

  const exportCsv = () =>
    Share.share({ title: `${session?.eventName} sales`, message: salesToCsv(list) }).catch(() => {});

  const closedAt = session?.closedAt ?? null;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const summary = { eventName: session?.eventName ?? 'Event', sales: list, closedAt, notShared: notShared.size, floats, giftAid: declarations };
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
        <Stat label="Cash taken" value={formatPence(totals.cash)} />
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

      <Card>
        <Heading>Cash to count</Heading>
        {tins.float === 0 ? (
          <Body muted>
            The tins should hold {formatPence(tins.inTin)}: the cash taken. If a tin started with a float, set it on the Event tab and
            it is added in here.
          </Body>
        ) : (
          <>
            <Body muted>
              Each tin should hold its opening float plus the cash it took.
              {session?.mode === 'cloud' ? ' Each till sets its own float on the Event tab.' : ''}
            </Body>
            <Row header cells={['Till', 'Float', 'Cash taken', 'In tin']} />
            {tins.rows.map((r) => (
              <Row key={r.tillName} cells={[r.tillName, formatPence(r.float), formatPence(r.cash), formatPence(r.inTin)]} />
            ))}
            {tins.rows.length > 1 && <Row cells={['All tins', formatPence(tins.float), formatPence(totals.cash), formatPence(tins.inTin)]} />}
          </>
        )}
      </Card>

      {(aid.donations > 0 || aid.count > 0) && (
        <Card>
          <Heading>Gift Aid</Heading>
          <Row header cells={['', 'Amount']} />
          <Row cells={['Donations taken', formatPence(aid.donations)]} />
          <Row cells={[`With a declaration (${aid.count})`, formatPence(aid.declared)]} />
          <Row cells={['Gift Aid to claim', formatPence(aid.claimable)]} />
          {isOrganiser ? (
            <>
              <Body muted>
                The export is laid out like HMRC’s Gift Aid schedule, ready to paste into the claim. It holds donors’ names and
                addresses, so keep it safe.
                {session?.mode === 'cloud' ? ' Declarations from tills with no signal are added when they reconnect.' : ''}
              </Body>
              <Button title="Export Gift Aid declarations" disabled={!aid.count} onPress={exportGiftAid} />
            </>
          ) : (
            <Body muted>
              Counts the declarations taken on this phone. They are sent to the organiser, who sees every till’s and makes the claim.
            </Body>
          )}
          {giftAidMessage && <Body>{giftAidMessage}</Body>}
        </Card>
      )}

      {session?.mode === 'cloud' && isOrganiser && (
        <Card>
          <Heading>Leaderboard</Heading>
          <Body muted>Each till’s takings, updating as sales come in. Big enough to show the stalls.</Body>
          <Button title="Show leaderboard" kind="primary" onPress={() => router.push('/leaderboard')} />
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
                {sale.cardRef ? ` · SumUp ${sale.cardRef}` : ''}
                {sale.cardUnconfirmed ? ' · check in SumUp' : ''}
                {sale.voided ? ' · voided' : ''}
                {notShared.has(sale.id) ? ' · not shared' : ''}
              </Label>
              <Text style={[s.num, { color: t.ink, fontWeight: '700', textDecorationLine: sale.voided ? 'line-through' : 'none' }]}>
                {formatPence(sale.total)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ color: t.ink, flex: 1 }}>
                {sale.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}
                {giftAid[sale.id] ? ' · Gift Aid' : ''}
              </Text>
              {/* A donor who said no at the till, or came back later, can still Gift Aid it. */}
              {!sale.voided && !giftAid[sale.id] && sale.deviceId === deviceId && donationIn(sale) > 0 && (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setGiftAidFor(sale)}>
                  <Text style={{ color: t.accent, fontWeight: '700' }}>Add Gift Aid</Text>
                </Pressable>
              )}
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
      <GiftAidPrompt
        sale={giftAidFor}
        onDone={(message) => {
          setGiftAidMessage(message);
          setGiftAidFor(null);
        }}
      />
    </ScrollView>
  );
}
