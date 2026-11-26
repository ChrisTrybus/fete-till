// The rules for event packs, kept apart from index.ts so they can be tested
// without Firebase or RevenueCat.

/**
 * Store product id -> events it pays for. The same ids are set up in App Store Connect,
 * Google Play and RevenueCat. Google Play's 1-event pack is cashtin_event_2, because
 * cashtin_event_1 was deleted there and Play never reuses a product id.
 */
export const PACKS: Record<string, number> = {
  cashtin_event_1: 1,
  cashtin_event_2: 1,
  cashtin_event_5: 5,
};

/** One purchase as RevenueCat's REST API (v1, GET /subscribers) lists it under non_subscriptions. */
export type StoreTransaction = {
  id?: unknown;
  store_transaction_id?: unknown;
  purchase_date?: unknown;
  store?: unknown;
  is_sandbox?: unknown;
};

export type Credit = { id: string; product: string; credits: number; at: string; store: string; sandbox: boolean };

/**
 * The pack purchases in a RevenueCat customer's history. Each has RevenueCat's
 * transaction id, which is what stops one purchase being counted twice.
 * Test purchases only count when `allowSandbox` is on, so that a TestFlight or
 * Play test build can't give out real credits once the app is live.
 */
export function packPurchases(nonSubscriptions: unknown, allowSandbox: boolean): Credit[] {
  if (!nonSubscriptions || typeof nonSubscriptions !== 'object') return [];
  const out: Credit[] = [];
  for (const [product, list] of Object.entries(nonSubscriptions as Record<string, unknown>)) {
    const credits = PACKS[product];
    if (!credits || !Array.isArray(list)) continue;
    for (const t of list as StoreTransaction[]) {
      const id = typeof t?.id === 'string' && t.id ? t.id : null;
      if (!id) continue;
      const sandbox = t.is_sandbox === true;
      if (sandbox && !allowSandbox) continue;
      out.push({
        id,
        product,
        credits,
        at: typeof t.purchase_date === 'string' ? t.purchase_date : '',
        store: typeof t.store === 'string' ? t.store : '',
        sandbox,
      });
    }
  }
  return out;
}

export type EventRequest = {
  eventId: string;
  name: string;
  tillName: string;
  items: unknown[];
  deviceId: string | null;
  accountToken: string | null;
};

/** Checks what the app sent to start a shared event. Returns the problem as a sentence, or the tidied request. */
export function readEventRequest(data: unknown): EventRequest | string {
  const d = (data ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const eventId = typeof d.eventId === 'string' ? d.eventId : '';
  if (!/^[A-Za-z0-9]{20}$/.test(eventId)) return 'Missing event id.';
  const name = str(d.name, 100);
  if (!name) return 'The event needs a name.';
  if (!Array.isArray(d.items)) return 'Missing price list.';
  if (d.items.length > 200) return 'A price list can have at most 200 items.';
  return {
    eventId,
    name,
    tillName: str(d.tillName, 60) || 'Till 1',
    items: d.items,
    deviceId: str(d.deviceId, 100) || null,
    accountToken: typeof d.accountToken === 'string' && d.accountToken ? d.accountToken : null,
  };
}

// No 0/O, 1/I/L so codes are easy to read aloud and type. The same as the app's.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A code of `len` characters, with `pick(n)` giving a random whole number below n. */
export const makeCode = (len: number, pick: (n: number) => number) =>
  Array.from({ length: len }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('');
