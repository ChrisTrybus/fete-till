// Event packs: credits on a Cash Tin account, each paying for one event with
// several tills. Events on just this phone are free and never need one.
//
// The server holds the count (accounts/{uid}, see functions/src/index.ts). The app
// buys through the store, then asks the server to count the purchase; it never
// changes the count itself.
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { AccountError } from './account-errors';
import { getAccountAuth, getAccountCloud } from './firebase';
import { buyProduct, purchasesAvailable, storePrices } from './store-purchases';

export { purchasesAvailable };

/**
 * The packs' product ids, which differ by store:
 *   App Store:   1 event = cashtin_event_1, 5 events = cashtin_event_2
 *   Google Play: 1 event = cashtin_event_2, 5 events = cashtin_event_5
 * (cashtin_event_1 was deleted on Play, and Play never reuses a product id.)
 * Keep in step with functions/src/packs.ts, both stores and RevenueCat.
 */
const IDS =
  Platform.OS === 'android'
    ? ({ one: 'cashtin_event_2', five: 'cashtin_event_5' } as const)
    : ({ one: 'cashtin_event_1', five: 'cashtin_event_2' } as const);

/** The packs on sale on this phone's store. */
export const PACKS = [
  { id: IDS.one, events: 1, fallbackPrice: '£0.99' },
  { id: IDS.five, events: 5, fallbackPrice: '£2.99' },
] as const;

export type PackId = (typeof PACKS)[number]['id'];

/** What the account holds. `unlocked` is set once any pack has been bought, and unlocks saved price lists for good. */
export type Credits = { credits: number; unlocked: boolean };

export const readCredits = (d: Record<string, unknown> | undefined): Credits => ({
  credits: Math.max(0, Math.floor(Number(d?.credits) || 0)),
  unlocked: d?.unlocked === true,
});

/** The signed-in account's credits, kept up to date. Null while loading, or with nobody signed in. */
export function useCredits(uid: string | null): Credits | null {
  // Tagged with the account it belongs to, so another account's figure is never shown.
  const [held, setHeld] = useState<{ uid: string; credits: Credits } | null>(null);
  useEffect(() => {
    const cloud = getAccountCloud();
    if (!uid || !cloud) return;
    return onSnapshot(
      doc(cloud.db, 'accounts', uid),
      (snap) => setHeld({ uid, credits: readCredits(snap.data()) }),
      () => setHeld({ uid, credits: { credits: 0, unlocked: false } }),
    );
  }, [uid]);
  return held && held.uid === uid ? held.credits : null;
}

function signedInUid(): string {
  const uid = getAccountAuth()?.currentUser?.uid;
  if (!uid) throw new AccountError('Sign in to your Cash Tin account first.');
  return uid;
}

/** Asks the server to count any packs this account has bought. Returns the credits it then holds. */
export async function syncPurchases(): Promise<Credits & { added: number }> {
  signedInUid();
  const cloud = getAccountCloud();
  if (!cloud) throw new Error('Cloud sync is not configured');
  const call = httpsCallable<void, Credits & { added: number }>(cloud.functions, 'syncPurchases', { timeout: 20000 });
  const { data } = await call();
  return data;
}

/** Store prices for the packs, or the usual UK prices if the store can't be reached. */
export async function packPrices(): Promise<Record<PackId, string>> {
  const fallback = Object.fromEntries(PACKS.map((p) => [p.id, p.fallbackPrice])) as Record<PackId, string>;
  if (!purchasesAvailable) return fallback;
  try {
    return { ...fallback, ...(await storePrices(signedInUid(), PACKS.map((p) => p.id))) };
  } catch {
    return fallback;
  }
}

/**
 * Buys a pack and has it counted. Resolves 'cancelled' if the person backed out,
 * 'counted' once the credits are on the account, or 'paid' if the purchase went
 * through but the server couldn't be reached to count it: checking again later
 * (Account > Check for purchases) picks it up, as the store keeps the purchase.
 */
export async function buyPack(id: PackId): Promise<'cancelled' | 'paid' | 'counted'> {
  const uid = signedInUid();
  if (!(await buyProduct(uid, id))) return 'cancelled';
  try {
    await syncPurchases();
    return 'counted';
  } catch {
    return 'paid';
  }
}
