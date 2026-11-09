// All money is stored as integer pence to avoid floating-point rounding errors.

export type Item = {
  id: string;
  name: string;
  price: number; // pence
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
};

// Writes waiting to reach Firestore. Processed in order; each is safe to retry.
export type OutboxOp =
  | { kind: 'sale'; sale: Sale }
  | { kind: 'void'; saleId: string; voided: boolean }
  | { kind: 'items'; items: Item[] };
