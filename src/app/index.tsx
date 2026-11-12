import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Bunting, Button, Card, Field, Heading, Label, useTheme } from '@/components/ui';
import { useStore } from '@/lib/store';

/** First screen: start a new event or join one with a code. */
export default function Welcome() {
  const t = useTheme();
  const store = useStore();
  const [eventName, setEventName] = useState('');
  const [tillName, setTillName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!store.loaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }
  if (store.session) return <Redirect href="/till" />;

  const till = tillName.trim() || 'Till 1';

  async function run(kind: 'create' | 'join', fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg === 'timeout' ? 'Couldn’t reach the server. Check you have signal, then try again.' : msg);
    } finally {
      setBusy(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Bunting />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 560, width: '100%', alignSelf: 'center' }}>
          <View style={{ gap: 4, paddingTop: 8 }}>
            <Text style={{ fontSize: 34, fontWeight: '800', color: t.ink }}>Cash Tin</Text>
            <Body muted>Take payments at your fete, fair or fundraiser, and add up every stall at the end of the day.</Body>
          </View>

          <Card>
            <Label>This till</Label>
            <Field value={tillName} onChangeText={setTillName} placeholder="e.g. Cake stall" />
          </Card>

          <Card>
            <Heading>Join an event</Heading>
            <Body muted>Ask the organiser for the 6-letter code.</Body>
            <Field
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              placeholder="ABC234"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              style={{ fontSize: 22, letterSpacing: 4, fontWeight: '700' }}
            />
            <Button
              title={busy === 'join' ? 'Joining…' : 'Join event'}
              kind="primary"
              disabled={!store.cloudEnabled || code.trim().length < 6 || busy !== null}
              onPress={() => run('join', () => store.joinCloudEvent(code, till))}
            />
          </Card>

          <Card>
            <Heading>Start a new event</Heading>
            <Field value={eventName} onChangeText={setEventName} placeholder="e.g. St Mary’s Summer Fete" />
            <Button
              title={busy === 'create' ? 'Creating…' : 'Start event'}
              disabled={!eventName.trim() || busy !== null}
              onPress={() =>
                store.cloudEnabled
                  ? run('create', () => store.createCloudEvent(eventName.trim(), till))
                  : store.startLocalEvent(eventName.trim(), till)
              }
            />
            {!store.cloudEnabled && (
              <Body muted>Sync isn’t set up in this build, so the event stays on this phone only.</Body>
            )}
          </Card>

          {error && <Text style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
