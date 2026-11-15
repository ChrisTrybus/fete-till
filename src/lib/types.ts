// All money is stored as integer pence to avoid floating-point rounding errors.

export type Item = {
  id: string;
  name: string;
  price: number; // pence
  // Names of the tills that sell this item. Left out when every till sells it.
  // Matched by till name, so two phones on one stall can share a name and a list.
  tills?: string[];
  // A heading the item is grouped under on the till, such as "Drinks". Optional.
  category?: string;
  // The colour of the item's tile on the till: one of COLOURS in categories.ts.
  // Items in one category share a colour. Left out to have one picked automatically.
  colour?: string;
  // A donation rather than something bought. Only donations can have Gift Aid claimed on them.
  // A donation with a price of 0 has no set amount: the till asks how much is being given.
  donation?: boolean;
};

export type SaleLine = {
  itemId: string;
  name: string; // copied at sale time so later price-list edits don't rewrite history
  price: number; // pence, copied at sale time
  qty: number;
  donation?: boolean; // copied from the item at sale time
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
  // Card sales taken through the SumUp app: SumUp's transaction code, for matching
  // against the SumUp account. Missing when the volunteer confirmed the payment by hand.
  cardRef?: string;
  // Set when SumUp never reported back and the volunteer said the payment went through.
  cardUnconfirmed?: boolean;
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
  // Whether tills take Gift Aid declarations, set by an organiser for the whole event.
  // Missing or null: they don't. A number: the till offers a declaration after a
  // donation of more than this many pence (0 offers it after every donation).
  giftAidOver?: number | null;
  // When this phone started or joined the event (epoch ms).
  startedAt?: number;
  // Cash put in this till's tin before the first sale (pence), so the counted cash can be checked.
  float?: number;
};

// The opening float of one till (pence).
export type TillFloat = { tillName: string; float: number };

// A phone that has joined a shared event, as the other tills see it.
// `joinedAt` is when it last registered (epoch ms). A phone whose sign-in changed
// appears more than once; its latest registration is the one that counts.
export type Member = { deviceId: string; tillName: string; float: number; joinedAt?: number };

// An event this phone has left, as listed under Past events. The totals are
// saved with it so the list can be shown without loading every sale.
export type PastEvent = {
  id: string; // the event's id
  name: string;
  mode: 'cloud' | 'local';
  tillName: string; // this phone's till name in the event
  startedAt: number; // epoch ms
  endedAt: number; // when this phone left the event (epoch ms)
  closedAt: number | null;
  takings: number; // pence, voided sales excluded
  cash: number; // pence
  card: number; // pence
  count: number; // sales, voided excluded
  // Each till's opening float, as this phone knew them when it left. Missing on older saves.
  floats?: TillFloat[];
};

// A donor's Gift Aid declaration, taken on the till after a sale that included a donation.
// It holds a name and address, so in a shared event only organisers can read it back.
export type GiftAidDeclaration = {
  saleId: string; // the sale holding the donation; also the Firestore doc id
  at: number; // when the declaration was made (epoch ms)
  // When the donation was taken: the sale's time (epoch ms). HMRC's schedule wants this
  // date, which differs from `at` when a donor comes back later. Missing on older saves.
  donatedAt?: number;
  amount: number; // the donation in the sale (pence); purchases in the same sale don't count
  firstName: string;
  lastName: string;
  house: string; // house name or number
  postcode: string;
  tillName: string;
  deviceId: string;
};

// Writes waiting to reach Firestore. Processed in order; each is safe to retry.
export type OutboxOp =
  | { kind: 'sale'; sale: Sale }
  | { kind: 'void'; saleId: string; voided: boolean }
  | { kind: 'items'; items: Item[] }
  | { kind: 'close'; closedAt: number | null } // null reopens the event
  | { kind: 'giftAidSetting'; over: number | null } // null turns declarations off
  | { kind: 'giftAid'; declaration: GiftAidDeclaration };

// A change the server refused outright (not a lost connection). It is set aside so
// the changes queued behind it can still send, and stays on the phone until the
// volunteer retries or discards it.
export type ParkedOp = { id: string; op: OutboxOp; reason: string };
