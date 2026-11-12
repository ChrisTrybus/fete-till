// Card payments through the SumUp app, using SumUp's "Payment Switch": the till opens
// the SumUp app with the amount, the volunteer takes the card there (on a SumUp reader,
// or Tap to Pay on the phone itself if their SumUp account has it), and SumUp opens this
// app again at /sumup-callback with the result.
//
// Each stall uses its own SumUp account, logged in to the SumUp app, so the money goes
// straight to whoever runs that account and never passes through this app or a server.
// The affiliate key identifies this app to SumUp; it is not a password. It is created in
// a SumUp account under Settings > For developers > Affiliate Keys, for the app id
// com.fetetill.app, and set as EXPO_PUBLIC_SUMUP_AFFILIATE_KEY.
//
// Docs: https://developer.sumup.com/terminal-payments/payment-switch/
import type { SaleLine } from './types';

export const SUMUP_CALLBACK_PATH = 'sumup-callback';
const CURRENCY = 'GBP';

/** A card payment handed to the SumUp app, waiting for its result. */
export type PendingCard = {
  /** Sent to SumUp as foreign-tx-id and used as the sale's id, so a result can only ever record one sale. */
  id: string;
  lines: SaleLine[];
  total: number; // pence
  startedAt: number; // epoch ms
};

/** How the last card payment ended, for the till to show. */
export type CardResult = { id: string; ok: boolean; message: string };

export type SumupLinkInput = {
  platform: 'ios' | 'android';
  affiliateKey: string;
  /** The Android application id the affiliate key was made for. Not sent on iOS. */
  appId: string;
  total: number; // pence
  title: string;
  id: string;
  /** Where SumUp sends the result, e.g. fetetill://sumup-callback. */
  callback: string;
};

const pounds = (pence: number) => (pence / 100).toFixed(2);

/** The link that opens the SumUp app to take a payment. */
export function sumupLink(i: SumupLinkInput): string {
  const params: [string, string][] = [
    ['affiliate-key', i.affiliateKey],
    // Android's SumUp app reads `total` from version 1.88; `amount` is for older versions.
    ...(i.platform === 'android' ? ([['app-id', i.appId], ['total', pounds(i.total)]] as [string, string][]) : []),
    ['amount', pounds(i.total)],
    ['currency', CURRENCY],
    ['title', i.title.slice(0, 100)],
    ['foreign-tx-id', i.id],
    // The till shows the outcome itself, so SumUp's own success screen is skipped.
    ['skip-screen-success', 'true'],
    ...(i.platform === 'android'
      ? ([['callback', i.callback]] as [string, string][])
      : ([
          ['callbacksuccess', i.callback],
          ['callbackfail', i.callback],
        ] as [string, string][])),
  ];
  return `sumupmerchant://pay/1.0?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}`;
}

export type SumupCallback = {
  ok: boolean;
  /** The foreign-tx-id sent with the payment, if SumUp passed it back. */
  id: string | null;
  /** SumUp's transaction code, for matching against the SumUp account. */
  txCode: string | null;
  message: string;
};

/** Reads the result SumUp sends back. Anything other than an explicit success is treated as not paid. */
export function parseSumupCallback(params: Record<string, string | string[] | undefined>): SumupCallback {
  const one = (k: string) => {
    const v = params[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s ? String(s) : null;
  };
  const status = one('smp-status');
  const ok = status === 'success';
  const fallback =
    status === 'invalidstate'
      ? 'SumUp couldn’t take the payment. Check you are logged in to the SumUp app with a UK account.'
      : 'The card payment didn’t go through.';
  return {
    ok,
    id: one('foreign-tx-id'),
    txCode: one('smp-tx-code'),
    message: ok ? 'Card payment taken.' : (one('smp-message') ?? fallback),
  };
}
