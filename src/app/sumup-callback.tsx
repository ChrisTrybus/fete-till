import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Body, useTheme } from '@/components/ui';
import { useStore } from '@/lib/store';

/**
 * Where the SumUp app sends the volunteer back after a card payment, as
 * fetetill://sumup-callback. The link only navigates. The volunteer verifies
 * the charge in SumUp before recording the sale.
 */
export default function SumupCallback() {
  const t = useTheme();
  const { loaded } = useStore();
  const done = useRef(false);

  useEffect(() => {
    // Restore the pending payment before returning to the till.
    if (!loaded || done.current) return;
    done.current = true;
    if (router.canGoBack()) router.back();
    else router.replace('/till');
  }, [loaded]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Body muted>Returning to the till…</Body>
    </View>
  );
}
