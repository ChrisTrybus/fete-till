import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Bunting, Button, Card, Heading, s, useTheme } from '@/components/ui';
import { listPastEvents } from '@/lib/history';
import { formatPence } from '@/lib/money';
import type { PastEvent } from '@/lib/types';

const day = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/** Every event this phone has left, newest first. */
export default function PastEvents() {
  const t = useTheme();
  const [events, setEvents] = useState<PastEvent[] | null>(null);
  const [failed, setFailed] = useState(false);

  // Reloaded each time the screen is shown, so an event deleted on its own page disappears here.
  useFocusEffect(
    useCallback(() => {
      let current = true;
      listPastEvents()
        .then((list) => current && setEvents(list))
        .catch(() => current && setFailed(true));
      return () => {
        current = false;
      };
    }, []),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Bunting />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, maxWidth: 620, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Heading>Past events</Heading>
          <Button title="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} style={{ paddingVertical: 8 }} />
        </View>
        <Body muted>
          Events are added here when you leave them. They are kept on this phone only, so they are lost if the app is deleted. Share a
          summary or export the sales to keep a copy.
        </Body>

        {failed && <Text style={{ color: t.danger, fontWeight: '700' }}>Couldn’t read the past events on this phone.</Text>}
        {events?.length === 0 && (
          <Card>
            <Body muted>No past events yet.</Body>
          </Card>
        )}
        {events?.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={`${e.name}, ${day(e.startedAt)}, ${formatPence(e.takings)}`}
            onPress={() => router.push({ pathname: '/history/[id]', params: { id: e.id } })}
            style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
          >
            <Card style={{ gap: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <Text numberOfLines={2} style={{ flex: 1, color: t.ink, fontSize: 17, fontWeight: '800' }}>
                  {e.name}
                </Text>
                <Text style={[s.num, { color: t.ink, fontSize: 17, fontWeight: '800' }]}>{formatPence(e.takings)}</Text>
              </View>
              <Text style={{ color: t.muted, fontSize: 13 }}>
                {day(e.startedAt)} · {e.count} {e.count === 1 ? 'sale' : 'sales'} · {e.mode === 'cloud' ? 'Several tills' : 'This phone only'}
              </Text>
            </Card>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
