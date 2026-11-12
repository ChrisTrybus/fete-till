// All money is stored as integer pence to avoid floating-point rounding errors.

export type Item = {
  id: string;
  name: string;
  price: number; // pence
  // Names of the tills that sell this item. Left out when every till sells it.
  // Matched by till name, so two phones on one stall can share a name and a list.
  tills?: string[];
};

export type SaleLine = {
  itemId: string;
  name: string; // copied at sale time so later price-list edits don't rewrite history
  price: number; // pence, copied at sale time
  qty: number;
};

export type PaymentMethod = 'cash' | 'card';

export type Sale = {
  id: string; // generated on the device; also the Firestore doc id, so retries are idempotent
  at: number; // epoch ms
  total: number; // pence
  method: PaymentMethod;
  tendered: number; // pence handed over (equals total for card)
  lines: SaleLine[];
  tillName: string;
  deviceId: string;
  voided: boolean;
};

export type Session = {
  eventId: string;
  eventName: string;
  code: string; // join code shown to other volunteers ('' in local-only mode)
  tillName: string;
  mode: 'cloud' | 'local';
  // Set on phones that hold the organiser role in a shared event. Only they can
  // change the price list or void another till's sales. Kept so the role can be
  // re-claimed if the phone's anonymous sign-in changes.
  organiserCode?: string;
  // When an organiser closed the event (epoch ms). While set, tills take no new sales.
  closedAt?: number | null;
};

// Writes waiting to reach Firestore. Processed in order; each is safe to retry.
export type OutboxOp =
  | { kind: 'sale'; sale: Sale }
  | { kind: 'void'; saleId: string; voided: boolean }
  | { kind: 'items'; items: Item[] }
  | { kind: 'close'; closedAt: number | null }; // null reopens the event

// A change the server refused outright (not a lost connection). It is set aside so
// the changes queued behind it can still send, and stays on the phone until the
// volunteer retries or discards it.
export type ParkedOp = { id: string; op: OutboxOp; reason: string };
