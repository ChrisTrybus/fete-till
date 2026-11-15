// Buying event packs from the App Store or Google Play, through RevenueCat.
//
// The account's uid is RevenueCat's app user id, so a purchase belongs to the Cash
// Tin account and the server can look it up (syncPurchases in functions/). This
// file only makes the purchase: credits are added by the server, never here.
//
// In Expo Go, react-native-purchases runs in a preview mode with no real purchases.
import { Platform } from 'react-native';
import { AccountError } from './account-errors';
import Purchases, { type PurchasesError, type PurchasesStoreProduct } from 'react-native-purchases';

const API_KEY =
  Platform.OS === 'ios'
    ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    : Platform.OS === 'android'
      ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
      : undefined;

/** True when this build can sell event packs: RevenueCat's key for this platform is set. */
export const purchasesAvailable = Boolean(API_KEY);

let configured = false;
let buyer: string | null = null;

/** Makes RevenueCat act for this account, setting it up the first time. */
async function actAs(uid: string) {
  if (!API_KEY) throw new AccountError('Event packs aren’t on sale in this version of the app.');
  if (!configured) {
    Purchases.configure({ apiKey: API_KEY, appUserID: uid });
    configured = true;
  } else if (buyer !== uid) {
    await Purchases.logIn(uid);
  }
  buyer = uid;
}

/** Store prices for the given products, in the phone's own currency, e.g. { cashtin_event_1: '£0.99' }. */
export async function storePrices(uid: string, productIds: string[]): Promise<Record<string, string>> {
  await actAs(uid);
  const products = await Purchases.getProducts(productIds, Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
  return Object.fromEntries(products.map((p: PurchasesStoreProduct) => [p.identifier, p.priceString]));
}

/** Buys one product for the account. Resolves false if the person cancelled. */
export async function buyProduct(uid: string, productId: string): Promise<boolean> {
  await actAs(uid);
  const [product] = await Purchases.getProducts([productId], Purchases.PRODUCT_CATEGORY.NON_SUBSCRIPTION);
  if (!product) throw new AccountError('That pack isn’t available in the store right now.');
  try {
    await Purchases.purchaseStoreProduct(product);
    return true;
  } catch (e) {
    if ((e as PurchasesError).userCancelled) return false;
    throw e;
  }
}

/** Stops RevenueCat acting for the account that has signed out. */
export async function forgetBuyer() {
  if (buyer === null) return;
  buyer = null;
  try {
    await Purchases.logOut();
  } catch {
    // Already anonymous to RevenueCat. Nothing to undo.
  }
}
