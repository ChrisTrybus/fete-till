import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { Body, useTheme } from '@/components/ui';
import { useStore } from '@/lib/store';
import { parseSumupCallback } from '@/lib/sumup';

/**
 * Where the SumUp app sends the volunteer back after a card payment, as
 * fetetill://sumup-callback?smp-status=…&foreign-tx-id=…. The result is handed to the
 * store, which records the sale if it was paid, then the till is shown again.
 */
export default function SumupCallback() {
  const t = useTheme();
  const params = useLocalSearchParams();
  const { loaded, finishCardPayment } = useStore();
  const done = useRef(false);

  useEffect(() => {
    // On a cold start, wait for the saved state: the payment waiting for this result is in it.
    if (!loaded || done.current) return;
    done.current = true;
    finishCardPayment(parseSumupCallback(params));
    if (router.canGoBack()) router.back();
    else router.replace('/till');
  }, [loaded, params, finishCardPayment]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Body muted>Finishing the card payment…</Body>
    </View>
  );
}
