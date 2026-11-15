// Event packs are bought in the phone app, through the App Store or Google Play.
// In a browser an account can still see and use its credits.
import { AccountError } from './account-errors';

export const purchasesAvailable = false;

export async function storePrices(_uid: string, _productIds: string[]): Promise<Record<string, string>> {
  return {};
}

export async function buyProduct(_uid: string, _productId: string): Promise<boolean> {
  throw new AccountError('Buy event packs in the Cash Tin app on your phone.');
}

export async function forgetBuyer() {}
