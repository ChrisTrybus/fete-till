import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Bunting, Button, Card, Choice, Field, Heading, Label, useTheme } from '@/components/ui';
import { useStore } from '@/lib/store';

/** First screen: start a new event or join one with a code. */
export default function Welcome() {
  const t = useTheme();
  const store = useStore();
  const [eventName, setEventName] = useState('');
  const [tillName, setTillName] = useState('');
  const [code, setCode] = useState('');
  // A new event stays on this phone unless the organiser asks to share it with other tills.
  const [sharing, setSharing] = useState<'local' | 'cloud'>('local');
  const [priceList, setPriceList] = useState<'last' | 'starter'>('last');
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
  const lastItems = store.lastItems?.length ? store.lastItems : null;
  const items = lastItems && priceList === 'last' ? lastItems : undefined; // undefined: the starter list
  const shared = store.cloudEnabled && sharing === 'cloud';

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
            <Heading>Start a new event</Heading>
            <Field value={eventName} onChangeText={setEventName} placeholder="e.g. St Mary’s Summer Fete" />
            {store.cloudEnabled && (
              <Choice
                value={sharing}
                onChange={setSharing}
                options={[
                  { value: 'local', title: 'Just this phone', detail: 'One till. Works with no signal.' },
                  { value: 'cloud', title: 'Several tills', detail: 'Other phones join with a code.' },
                ]}
              />
            )}
            {lastItems && (
              <>
                <Label>Price list</Label>
                <Choice
                  value={priceList}
                  onChange={setPriceList}
                  options={[
                    { value: 'last', title: 'Same as last time', detail: `${lastItems.length} ${lastItems.length === 1 ? 'item' : 'items'}` },
                    { value: 'starter', title: 'Starter list', detail: 'Tea, cake, tombola…' },
                  ]}
                />
              </>
            )}
            <Button
              title={busy === 'create' ? 'Creating…' : 'Start event'}
              kind="primary"
              disabled={!eventName.trim() || busy !== null}
              onPress={() =>
                shared
                  ? run('create', () => store.createCloudEvent(eventName.trim(), till, items))
                  : store.startLocalEvent(eventName.trim(), till, items)
              }
            />
            <Body muted>
              {shared
                ? 'Needs signal to start. After that each till keeps selling without it.'
                : 'Sales are kept on this phone. You can change the price list once the event has started.'}
            </Body>
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
              disabled={!store.cloudEnabled || code.trim().length < 6 || busy !== null}
              onPress={() => run('join', () => store.joinCloudEvent(code, till))}
            />
            {!store.cloudEnabled && <Body muted>Sync isn’t set up in this build, so events can’t be joined.</Body>}
          </Card>

          {error && <Text style={{ color: t.danger, fontWeight: '700' }}>{error}</Text>}

          <Button title="Past events" onPress={() => router.push('/history')} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
