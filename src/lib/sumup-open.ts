// Opening the SumUp app from this phone. Kept apart from sumup.ts so the link
// building and result reading can be tested without React Native.
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { SUMUP_CALLBACK_PATH, sumupLink } from './sumup';

// Must be read as written here: Expo inlines EXPO_PUBLIC_ variables at build time.
const AFFILIATE_KEY = process.env.EXPO_PUBLIC_SUMUP_AFFILIATE_KEY ?? '';

/** True when this build can hand card payments to the SumUp app: a phone, with an affiliate key set. */
export const sumupAvailable = (Platform.OS === 'ios' || Platform.OS === 'android') && AFFILIATE_KEY.trim().length > 0;

/** Why SumUp can't be used on this phone, or null if it can. */
export const sumupUnavailableReason = (): string | null =>
  Platform.OS !== 'ios' && Platform.OS !== 'android'
    ? 'SumUp works on a phone or tablet with the SumUp app, not in a browser.'
    : !AFFILIATE_KEY.trim()
      ? 'This version of the app hasn’t been set up for SumUp yet.'
      : null;

/** Opens the SumUp app to take `total` pence. Rejects with a readable message if it can't be opened. */
export async function openSumup(payment: { id: string; total: number; title: string }) {
  if (!sumupAvailable) throw new Error(sumupUnavailableReason() ?? 'SumUp isn’t available.');
  const url = sumupLink({
    platform: Platform.OS as 'ios' | 'android',
    affiliateKey: AFFILIATE_KEY.trim(),
    appId: Constants.expoConfig?.android?.package ?? 'com.fetetill.app',
    total: payment.total,
    title: payment.title,
    id: payment.id,
    callback: Linking.createURL(SUMUP_CALLBACK_PATH),
  });
  try {
    await Linking.openURL(url);
  } catch {
    throw new Error('Couldn’t open the SumUp app. Check it is installed and you are logged in.');
  }
}
