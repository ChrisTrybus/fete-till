import { Redirect, router, Tabs } from 'expo-router';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bunting, useTheme } from '@/components/ui';
import { useStore, type SyncStatus } from '@/lib/store';

const statusText: Record<SyncStatus, string> = {
  local: 'This phone only',
  synced: 'Synced',
  sending: 'Sending…',
  waiting: 'Offline, saved here',
  attention: 'Needs attention',
};

/** Below this width (phones) the header and tab bar are slimmed to give the till more room. */
const PHONE_MAX_WIDTH = 760;

function Header() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { session, syncStatus, outbox, flushNow } = useStore();
  // With nothing to send, the pill opens the Event tab, where refused changes are listed.
  const onPress = syncStatus === 'attention' ? () => router.navigate('/event') : flushNow;
  const compact = useWindowDimensions().width < PHONE_MAX_WIDTH;
  const pending = outbox.length;
  const dot = syncStatus === 'synced' ? t.accent : syncStatus === 'local' ? t.muted : syncStatus === 'attention' ? t.danger : t.sun;
  return (
    <View style={{ backgroundColor: t.surface, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: compact ? 5 : 10 }}>
        {compact ? (
          // Phones: event and till share one line, to leave the screen to the till itself.
          // A long event name gives way first, so the till name stays readable.
          <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, color: t.ink, fontSize: 15, fontWeight: '800' }}>
              {session?.eventName}
            </Text>
            <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: '45%', color: t.muted, fontSize: 13 }}>
              {session?.tillName}
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
              {session?.eventName}
            </Text>
            <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>
              {session?.tillName}
            </Text>
          </View>
        )}
        <Pressable
          onPress={onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Sync status: ${statusText[syncStatus]}. ${syncStatus === 'attention' ? 'Tap to see what was not shared.' : 'Tap to send now.'}`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: compact ? 3 : 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: t.line }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
          <Text style={{ color: t.ink, fontSize: 13, fontWeight: '700' }}>
            {statusText[syncStatus]}
            {pending > 0 && syncStatus !== 'local' ? ` · ${pending}` : ''}
          </Text>
        </Pressable>
      </View>
      <Bunting />
    </View>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const { loaded, session } = useStore();
  const insets = useSafeAreaInsets();
  const compact = useWindowDimensions().width < PHONE_MAX_WIDTH;
  // Wait for saved state before mounting any tab, so screens never start from empty data.
  if (!loaded) return <View style={{ flex: 1, backgroundColor: t.bg }} />;
  if (!session) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        header: () => <Header />,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line, ...(compact ? { height: 40 + insets.bottom } : null) },
        tabBarLabelStyle: { fontSize: compact ? 13 : 14, fontWeight: '700' },
        tabBarIconStyle: { display: 'none' },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen name="till" options={{ title: 'Till' }} />
      <Tabs.Screen name="items" options={{ title: 'Price list' }} />
      <Tabs.Screen name="day" options={{ title: 'Day total' }} />
      <Tabs.Screen name="event" options={{ title: 'Event' }} />
    </Tabs>
  );
}
