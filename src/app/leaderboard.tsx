import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Bunting, Button, s, useTheme } from '@/components/ui';
import { ago, standings, standingsText } from '@/lib/leaderboard';
import { formatPence } from '@/lib/money';
import { useStore } from '@/lib/store';

const KEEP_AWAKE_TAG = 'leaderboard';
const back = () => (router.canGoBack() ? router.back() : router.replace('/day'));

/**
 * Each till's takings, ranked and updating as sales arrive from the other tills.
 * Laid out large, so the organiser can hold it up or prop it on a table for the stalls.
 */
export default function Leaderboard() {
  const t = useTheme();
  const { loaded, session, sales, tills, syncStatus } = useStore();
  const { width } = useWindowDimensions();
  const big = width >= 760;
  // Moves "3 min ago" on even when no sale arrives.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      clearInterval(timer);
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, []);

  const rows = useMemo(() => standings(Object.values(sales), [...tills, session?.tillName ?? '']), [sales, tills, session?.tillName]);
  const total = rows.reduce((sum, r) => sum + r.takings, 0);

  if (!loaded) return null;
  if (!session) return <Redirect href="/" />;

  const share = () =>
    Share.share({ title: `${session.eventName} leaderboard`, message: standingsText(session.eventName, rows, Date.now()) }).catch(() => {});

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <Bunting />
      <ScrollView contentContainerStyle={{ padding: 16, gap: big ? 16 : 12, maxWidth: 960, width: '100%', alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={{ color: t.ink, fontSize: big ? 34 : 24, fontWeight: '800' }}>
              {session.eventName}
            </Text>
            <Text style={[s.num, { color: t.muted, fontSize: big ? 20 : 15, fontWeight: '700' }]}>
              {formatPence(total)} across {rows.length} {rows.length === 1 ? 'till' : 'tills'}
            </Text>
          </View>
          <Button title="Back" onPress={back} style={{ paddingVertical: 8 }} />
        </View>

        {rows.length === 0 && <Body muted>No tills have joined yet.</Body>}

        {rows.map((r, i) => {
          const leader = r.place === 1 && r.takings > 0;
          const bar = leader ? t.sun : t.bunting[(i + 2) % t.bunting.length];
          return (
            <View
              key={r.tillName}
              accessible
              accessibilityLabel={`Place ${r.place}: ${r.tillName}, ${formatPence(r.takings)}, ${r.count} sales, last sale ${ago(r.lastSaleAt, now)}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: big ? 16 : 12,
                padding: big ? 18 : 12,
                borderRadius: 16,
                borderWidth: leader ? 2 : 1,
                borderColor: leader ? t.sun : t.line,
                backgroundColor: t.surface,
              }}
            >
              <View
                style={{
                  width: big ? 56 : 40,
                  height: big ? 56 : 40,
                  borderRadius: 999,
                  backgroundColor: leader ? t.sun : t.bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={[s.num, { color: leader ? t.sunInk : t.ink, fontSize: big ? 26 : 18, fontWeight: '800' }]}>{r.place}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, color: t.ink, fontSize: big ? 26 : 18, fontWeight: '800' }}>
                    {r.tillName}
                  </Text>
                  <Text style={[s.num, { color: t.ink, fontSize: big ? 32 : 22, fontWeight: '800' }]}>{formatPence(r.takings)}</Text>
                </View>
                <View style={{ height: big ? 14 : 10, borderRadius: 999, backgroundColor: t.bg, overflow: 'hidden' }}>
                  <View style={{ width: `${Math.max(r.share * 100, r.takings ? 2 : 0)}%`, height: '100%', borderRadius: 999, backgroundColor: bar }} />
                </View>
                <Text style={{ color: t.muted, fontSize: big ? 16 : 13 }}>
                  {r.count} {r.count === 1 ? 'sale' : 'sales'} · {ago(r.lastSaleAt, now)}
                </Text>
              </View>
            </View>
          );
        })}

        <Body muted>
          {syncStatus === 'waiting'
            ? 'This phone has no signal, so the board may be behind. It catches up when the signal returns.'
            : 'Updates as sales come in. A till with no signal adds its sales when it reconnects.'}
        </Body>
        <Button title="Share standings" onPress={share} />
      </ScrollView>
    </SafeAreaView>
  );
}
