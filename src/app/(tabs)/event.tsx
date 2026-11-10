import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { Body, Button, Card, Field, Heading, Label, useTheme } from '@/components/ui';
import { formatPence } from '@/lib/money';
import { useStore } from '@/lib/store';
import type { OutboxOp } from '@/lib/types';

const describe = (op: OutboxOp) =>
  op.kind === 'items'
    ? 'Price list changes'
    : op.kind === 'sale'
      ? `Sale of ${formatPence(op.sale.total)} at ${new Date(op.sale.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : op.voided
        ? 'Voiding a sale'
        : 'Restoring a voided sale';

const advice = (op: OutboxOp) =>
  op.kind === 'items'
    ? 'Fix it on the Price list tab and save again, or discard to go back to the list the other tills have.'
    : op.kind === 'sale'
      ? 'It stays in this phone’s Day total and CSV export. If it should not count, void it on the Day total tab.'
      : 'Discard to put the sale back as the other tills see it.';

/** Join code to share, this till's name, sync details, and leaving the event. */
export default function EventScreen() {
  const t = useTheme();
  const { session, setTillName, outbox, parked, syncStatus, syncError, flushNow, retryParked, discardParked, leaveEvent } = useStore();
  const unshared = outbox.length + parked.length;
  const [till, setTill] = useState(session?.tillName ?? '');
  const [confirmLeave, setConfirmLeave] = useState(false);
  if (!session) return null;

  const spaced = session.code.replace(/(.{3})/, '$1 ');

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' }}>
      {session.mode === 'cloud' ? (
        <Card>
          <Label>Join code</Label>
          <Text selectable style={{ color: t.ink, fontSize: 44, fontWeight: '800', letterSpacing: 6, textAlign: 'center' }}>
            {spaced}
          </Text>
          <Body muted>Other volunteers open Fete Till, tap Join event and enter this code. Their sales add into the day total.</Body>
          <Button
            title="Share code"
            onPress={() =>
              Share.share({ message: `Join "${session.eventName}" on Fete Till with code ${session.code}` }).catch(() => {})
            }
          />
        </Card>
      ) : (
        <Card>
          <Heading>This phone only</Heading>
          <Body muted>This event isn’t synced, so other phones can’t join it. Sales are kept on this phone.</Body>
        </Card>
      )}

      <Card>
        <Label>This till</Label>
        <Field value={till} onChangeText={setTill} placeholder="e.g. Cake stall" />
        <Button title="Rename till" disabled={!till.trim() || till.trim() === session.tillName} onPress={() => setTillName(till.trim())} />
        <Body muted>New sales use the new name. Earlier sales keep the name they were taken under.</Body>
      </Card>

      {session.mode === 'cloud' && (
        <Card>
          <Label>Sync</Label>
          <Body>
            {outbox.length === 0 ? (parked.length ? 'Nothing is waiting to send.' : 'Everything on this phone has been sent.') : `${outbox.length} change${outbox.length === 1 ? '' : 's'} waiting to send.`}
          </Body>
          {syncStatus === 'waiting' && syncError && <Body muted>{syncError}</Body>}
          <Button title="Send now" disabled={outbox.length === 0} onPress={flushNow} />
        </Card>
      )}

      {parked.length > 0 && (
        <Card style={{ borderColor: t.danger }}>
          <Label>Not shared</Label>
          <Body muted>
            The event would not accept {parked.length === 1 ? 'this change' : 'these changes'}, so other tills can’t see{' '}
            {parked.length === 1 ? 'it' : 'them'}. Everything else is still being sent.
          </Body>
          {parked.map((p) => (
            <View key={p.id} style={{ gap: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: t.line }}>
              <Text style={{ color: t.ink, fontSize: 16, fontWeight: '700' }}>{describe(p.op)}</Text>
              <Body>{p.reason}</Body>
              <Body muted>{advice(p.op)}</Body>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button title="Try again" onPress={() => retryParked(p.id)} style={{ flex: 1 }} />
                {p.op.kind !== 'sale' && (
                  <Button title="Discard" kind="danger" onPress={() => discardParked(p.id)} style={{ flex: 1 }} />
                )}
              </View>
            </View>
          ))}
        </Card>
      )}

      <Card>
        <Label>Finished?</Label>
        <Body muted>
          {unshared > 0
            ? `Leaving now would lose ${unshared} change${unshared === 1 ? '' : 's'} that other tills don’t have.` +
              (outbox.length > 0 ? ' Get some signal and tap Send now first.' : ' Export the sales from Day total first if you need them.')
            : 'Leaving removes this event from this phone. Synced sales stay in the event.'}
        </Body>
        <View>
          <Button
            title={confirmLeave ? 'Tap again to leave' : 'Leave event'}
            kind="danger"
            onPress={() => (confirmLeave ? leaveEvent() : setConfirmLeave(true))}
          />
        </View>
      </Card>
    </ScrollView>
  );
}
