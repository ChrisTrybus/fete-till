import { Redirect, Tabs } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bunting, useTheme } from '@/components/ui';
import { useStore, type SyncStatus } from '@/lib/store';

const statusText: Record<SyncStatus, string> = {
  local: 'This phone only',
  synced: 'Synced',
  sending: 'Sending…',
  waiting: 'Offline, saved here',
};

function Header() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { session, syncStatus, outbox, flushNow } = useStore();
  const pending = outbox.length;
  const dot = syncStatus === 'synced' ? t.accent : syncStatus === 'local' ? t.muted : t.sun;
  return (
    <View style={{ backgroundColor: t.surface, paddingTop: insets.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ color: t.ink, fontSize: 17, fontWeight: '800' }}>
            {session?.eventName}
          </Text>
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>
            {session?.tillName}
          </Text>
        </View>
        <Pressable
          onPress={flushNow}
          accessibilityRole="button"
          accessibilityLabel={`Sync status: ${statusText[syncStatus]}. Tap to send now.`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: t.line }}
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
  if (loaded && !session) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        header: () => <Header />,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
        tabBarLabelStyle: { fontSize: 14, fontWeight: '700' },
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
