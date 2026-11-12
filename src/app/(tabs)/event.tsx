import { router } from 'expo-router';
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
      : op.kind === 'close'
        ? op.closedAt
          ? 'Closing the event'
          : 'Reopening the event'
        : op.voided
        ? 'Voiding a sale'
        : 'Restoring a voided sale';

const advice = (op: OutboxOp) =>
  op.kind === 'items'
    ? 'If you are an organiser, fix it on the Price list tab and save again. Otherwise discard to go back to the list the other tills have.'
    : op.kind === 'sale'
      ? 'It stays in this phone’s Day total and CSV export. If it should not count, void it on the Day total tab.'
      : op.kind === 'close'
        ? 'Discard to go back to what the other tills see.'
        :'Discard to put the sale back as the other tills see it.';

/** Join code to share, this till's name, sync details, and leaving the event. */
export default function EventScreen() {
  const t = useTheme();
  const { session, setTillName, outbox, parked, syncStatus, syncError, flushNow, retryParked, discardParked, leaveEvent, isOrganiser, claimOrganiser, setClosed } =
    useStore();
  const [confirmClose, setConfirmClose] = useState(false);
  const [organiserCode, setOrganiserCode] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const unshared = outbox.length + parked.length;
  const [till, setTill] = useState(session?.tillName ?? '');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Set when the event couldn't be saved to Past events, so leaving would lose its sales.
  const [leaveFailed, setLeaveFailed] = useState(false);
  if (!session) return null;

  const spaced = session.code.replace(/(.{3})/, '$1 ');

  const leave = async () => {
    setLeaving(true);
    try {
      await leaveEvent({ skipHistory: leaveFailed });
    } catch {
      setLeaveFailed(true);
    } finally {
      setLeaving(false);
    }
  };

  const claim = async () => {
    setClaiming(true);
    setClaimError(null);
    try {
      await claimOrganiser(organiserCode);
      setOrganiserCode('');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setClaimError(msg === 'timeout' ? 'Couldn’t reach the server. Check you have signal, then try again.' : msg);
    } finally {
      setClaiming(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' }}>
      {session.mode === 'cloud' ? (
        <Card>
          <Label>Join code</Label>
          <Text selectable style={{ color: t.ink, fontSize: 44, fontWeight: '800', letterSpacing: 6, textAlign: 'center' }}>
            {spaced}
          </Text>
          <Body muted>Other volunteers open Cash Tin, tap Join event and enter this code. Their sales add into the day total.</Body>
          <Button
            title="Share code"
            onPress={() =>
              Share.share({ message: `Join "${session.eventName}" on Cash Tin with code ${session.code}` }).catch(() => {})
            }
          />
        </Card>
      ) : (
        <Card>
          <Heading>This phone only</Heading>
          <Body muted>This event isn’t synced, so other phones can’t join it. Sales are kept on this phone.</Body>
        </Card>
      )}

      {session.mode === 'cloud' &&
        (isOrganiser ? (
          <Card>
            <Label>Organiser code</Label>
            <Text selectable style={{ color: t.ink, fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center' }}>
              {session.organiserCode?.replace(/(.{4})/, '$1 ')}
            </Text>
            <Body muted>
              This phone is an organiser: it can change the price list and void any till’s sales. Keep this code somewhere safe. You
              need it to be the organiser on another phone, or on this one if the app is reinstalled. Only give it to people who
              should run the event.
            </Body>
            <Button
              title="Save code somewhere safe"
              onPress={() =>
                Share.share({ message: `Organiser code for "${session.eventName}" on Cash Tin: ${session.organiserCode}` }).catch(() => {})
              }
            />
          </Card>
        ) : (
          <Card>
            <Label>Organiser</Label>
            <Body muted>
              Only an organiser can change the price list or void another till’s sales. If you run this event, enter the organiser
              code from the phone that started it.
            </Body>
            <Field
              value={organiserCode}
              onChangeText={(v) => setOrganiserCode(v.toUpperCase())}
              placeholder="Organiser code"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
            />
            <Button
              title={claiming ? 'Checking…' : 'Become an organiser'}
              disabled={claiming || organiserCode.replace(/[^A-Za-z0-9]/g, '').length < 8}
              onPress={claim}
            />
            {claimError && <Text style={{ color: t.danger, fontWeight: '700' }}>{claimError}</Text>}
          </Card>
        ))}

      <Card>
        <Label>This till</Label>
        <Field value={till} onChangeText={setTill} placeholder="e.g. Cake stall" />
        <Button title="Rename till" disabled={!till.trim() || till.trim() === session.tillName} onPress={() => setTillName(till.trim())} />
        <Body muted>New sales use the new name. Earlier sales keep the name they were taken under.</Body>
      </Card>

      {session.closedAt ? (
        <Card style={{ borderColor: t.accent }}>
          <Label>Event closed</Label>
          <Body>
            Closed at {new Date(session.closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. No more sales can be
            taken. The end-of-day summary is on the Day total tab.
          </Body>
          {isOrganiser ? (
            <Button title="Reopen event" onPress={() => setClosed(false)} />
          ) : (
            <Body muted>If it was closed by mistake, the organiser can reopen it.</Body>
          )}
        </Card>
      ) : (
        isOrganiser && (
          <Card>
            <Label>End of the day</Label>
            <Body muted>
              Closing the event stops {session.mode === 'cloud' ? 'every till' : 'the till'} taking sales and gives you a summary to send
              to your treasurer. You can reopen it if you close it by mistake.
              {session.mode === 'cloud' ? ' A till with no signal stops when it reconnects, and the sales it took still count.' : ''}
            </Body>
            <Button
              title={confirmClose ? 'Tap again to close the event' : 'Close event'}
              onPress={() => {
                if (confirmClose) setClosed(true);
                setConfirmClose(!confirmClose);
              }}
            />
          </Card>
        )
      )}

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
            ? `${unshared} change${unshared === 1 ? '' : 's'} on this phone ${unshared === 1 ? 'has' : 'have'} not reached the other tills, and won’t if you leave now.` +
              (outbox.length > 0 ? ' Get some signal and tap Send now first.' : '')
            : session.mode === 'cloud'
              ? 'Leaving takes this phone out of the event. Synced sales stay in the event.'
              : 'Leaving ends the event on this phone.'}{' '}
          The sales on this phone are kept under Past events.
        </Body>
        {leaveFailed && (
          <Text style={{ color: t.danger, fontWeight: '700' }}>
            Couldn’t save this event to Past events. Export the sales from Day total first, or leave without saving.
          </Text>
        )}
        <View style={{ gap: 8 }}>
          <Button
            title={leaving ? 'Leaving…' : leaveFailed ? 'Leave without saving' : confirmLeave ? 'Tap again to leave' : 'Leave event'}
            kind="danger"
            disabled={leaving}
            onPress={() => (confirmLeave ? leave() : setConfirmLeave(true))}
          />
          <Button title="Past events" onPress={() => router.push('/history')} />
        </View>
      </Card>
    </ScrollView>
  );
}
