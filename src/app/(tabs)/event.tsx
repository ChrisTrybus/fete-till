import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { Body, Button, Card, Field, Heading, Label, useTheme } from '@/components/ui';
import { useStore } from '@/lib/store';

/** Join code to share, this till's name, sync details, and leaving the event. */
export default function EventScreen() {
  const t = useTheme();
  const { session, setTillName, outbox, syncStatus, syncError, flushNow, leaveEvent } = useStore();
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
            {outbox.length === 0 ? 'Everything on this phone has been sent.' : `${outbox.length} change${outbox.length === 1 ? '' : 's'} waiting to send.`}
          </Body>
          {syncStatus === 'waiting' && syncError && <Body muted>{syncError}</Body>}
          <Button title="Send now" disabled={outbox.length === 0} onPress={flushNow} />
        </Card>
      )}

      <Card>
        <Label>Finished?</Label>
        <Body muted>
          {outbox.length > 0
            ? `Leaving now would lose ${outbox.length} unsent change${outbox.length === 1 ? '' : 's'}. Get some signal and tap Send now first.`
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
