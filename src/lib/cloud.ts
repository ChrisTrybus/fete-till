// Firestore layout (see firestore.rules for who can do what):
//   codes/{CODE}                      { eventId }            join code -> event lookup
//   events/{eventId}                  { name, code, createdBy, createdAt, items[], closedAt?, giftAidOver?, account?, paid? }
//   events/{eventId}/members/{uid}    { code, tillName, joinedAt, deviceId?, float? }
//   events/{eventId}/private/organiser { code }             organiser code; no device can read it
//   events/{eventId}/organisers/{uid} { code, claimedAt }   devices that have proved they know it
//   events/{eventId}/sales/{saleId}   Sale + { createdBy }
//   events/{eventId}/giftAid/{saleId} GiftAidDeclaration + { createdBy }   only organisers can read these
// Events, their codes and organiser codes are made by the server: see functions/src/index.ts.
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ensureSignedIn, getAccountAuth, getCloud, getEventFunctions } from './firebase';
import type { GiftAidDeclaration, Item, Member, OutboxOp, Sale } from './types';

export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function db() {
  const c = getCloud();
  if (!c) throw new Error('Cloud sync is not configured');
  return c.db;
}

/** Waits for a Firestore write, but gives up after `ms`. Offline writes stay queued in the SDK either way. */
const withTimeout = <T,>(p: Promise<T>, ms = 10000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** Starting a shared event was refused until the organiser signs in, or buys an event pack. */
export class NeedsPack extends Error {
  constructor(
    message: string,
    readonly reason: 'sign-in' | 'no-credits',
  ) {
    super(message);
    this.name = 'NeedsPack';
  }
}

type Started = { eventId: string; code: string; organiserCode: string };

/**
 * Starts a shared event, with this phone as its organiser and first till. The server
 * makes it (functions/src/index.ts), so that it can spend an event pack credit from
 * the signed-in account. The event id is picked here, so trying again after a lost
 * reply returns the same event instead of spending a second credit.
 */
export async function createEvent(name: string, tillName: string, items: Item[], deviceId?: string): Promise<Started> {
  await ensureSignedIn();
  const functions = getEventFunctions();
  if (!functions) throw new Error('Cloud sync is not configured');
  const eventId = doc(collection(db(), 'events')).id;
  const start = httpsCallable<object, Started>(functions, 'startSharedEvent', { timeout: 20000 });

  for (let attempt = 0; ; attempt++) {
    // Fetched each time: a token can expire between tries.
    const accountToken = (await getAccountAuth()?.currentUser?.getIdToken()) ?? null;
    try {
      const { data } = await start({ eventId, name, tillName, items, deviceId: deviceId ?? null, accountToken });
      return data;
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const reason = ((e as { details?: { reason?: unknown } }).details?.reason ?? null) as string | null;
      if (code === 'functions/failed-precondition' && (reason === 'sign-in' || reason === 'no-credits')) {
        throw new NeedsPack((e as Error).message, reason);
      }
      if (code === 'functions/invalid-argument') throw new Error((e as Error).message);
      if (code === 'functions/not-found') {
        throw new Error('Events with several tills aren’t set up on the server yet. Deploy the Cloud Functions.');
      }
      // A lost connection or a slow server: once more with the same id, which is safe.
      if (attempt >= 1) throw new Error('timeout');
    }
  }
}

/** Registers this device as an organiser. The server refuses it unless the code is the event's organiser code. */
export async function claimOrganiser(eventId: string, organiserCode: string) {
  const uid = await ensureSignedIn();
  await withTimeout(
    setDoc(doc(db(), 'events', eventId, 'organisers', uid), { code: organiserCode, claimedAt: Date.now() }),
  );
}

const toMember = (m: DocumentData): Member => {
  const float = Number(m.float);
  return { deviceId: String(m.deviceId ?? ''), tillName: String(m.tillName ?? ''), float: float > 0 ? float : 0, joinedAt: Number(m.joinedAt) || 0 };
};

/**
 * Joins an event by its code. `deviceId` identifies this phone: if it was in the
 * event before, the opening float it recorded then is returned as `float`.
 */
export async function joinEvent(rawCode: string, tillName: string, deviceId?: string) {
  await ensureSignedIn();
  const code = normaliseCode(rawCode);
  const codeSnap = await withTimeout(getDoc(doc(db(), 'codes', code)));
  if (!codeSnap.exists()) throw new Error(`No event found with code ${code}. Check the code and try again.`);
  const eventId = codeSnap.data().eventId as string;
  await joinAsMember(eventId, code, tillName, deviceId ? { deviceId } : undefined);
  const eventSnap = await withTimeout(getDoc(doc(db(), 'events', eventId)));
  const data = eventSnap.data() ?? {};

  // A phone that left and has come back gets its float back: the sales it took
  // are still in the event, so the cash in its tin still has to add up. The
  // float may be on an earlier record, if the phone's sign-in has changed since.
  let float = 0;
  if (deviceId) {
    try {
      const members = await withTimeout(getDocs(collection(db(), 'events', eventId, 'members')));
      const mine = members.docs.map((d) => toMember(d.data())).filter((m) => m.deviceId === deviceId && m.float > 0);
      float = mine.sort((a, b) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0))[0]?.float ?? 0;
    } catch {
      // Joining has worked. The float can be entered again on the Event tab.
    }
  }
  return { eventId, code, eventName: (data.name as string) ?? 'Event', items: (data.items as Item[]) ?? [], float, giftAidOver: giftAidOverOf(data) };
}

/** The event's Gift Aid setting: null (declarations off) unless it holds a sensible amount. */
const giftAidOverOf = (d: DocumentData): number | null =>
  typeof d.giftAidOver === 'number' && d.giftAidOver >= 0 ? d.giftAidOver : null;

/**
 * (Re)registers this device's anonymous user as a member. Safe to call on every launch.
 * `till` carries what the other tills should know about this one: its opening float,
 * and the device id that tells this phone's own entry apart from the rest.
 *
 * The write is merged into any record already there, so joining again without a
 * float leaves the one recorded earlier in place.
 */
export async function joinAsMember(eventId: string, code: string, tillName: string, till?: { deviceId: string; float?: number }) {
  const uid = await ensureSignedIn();
  await withTimeout(
    setDoc(
      doc(db(), 'events', eventId, 'members', uid),
      {
        code,
        tillName,
        joinedAt: Date.now(),
        ...(till ? { deviceId: till.deviceId } : {}),
        ...(till?.float === undefined ? {} : { float: till.float }),
      },
      { merge: true },
    ),
  );
}

/** Sends one queued write. Throws if it couldn't be confirmed, so the caller keeps it queued. */
export async function pushOp(eventId: string, op: OutboxOp) {
  const uid = await ensureSignedIn();
  const event = doc(db(), 'events', eventId);
  switch (op.kind) {
    case 'sale':
      // createdBy is stamped at send time, so a sale queued before an app restart
      // (which may bring a new anonymous id) is still accepted.
      await withTimeout(setDoc(doc(event, 'sales', op.sale.id), { ...op.sale, createdBy: uid }));
      break;
    case 'void':
      await withTimeout(updateDoc(doc(event, 'sales', op.saleId), { voided: op.voided, voidedAt: Date.now() }));
      break;
    case 'items':
      await withTimeout(updateDoc(event, { items: op.items }));
      break;
    case 'close':
      await withTimeout(updateDoc(event, { closedAt: op.closedAt }));
      break;
    case 'giftAidSetting':
      await withTimeout(updateDoc(event, { giftAidOver: op.over }));
      break;
    case 'giftAid':
      await withTimeout(setDoc(doc(event, 'giftAid', op.declaration.saleId), { ...op.declaration, createdBy: uid }));
      break;
  }
}

/** True if the server already holds this sale, e.g. from a send whose confirmation was lost. */
export async function saleExists(eventId: string, saleId: string) {
  await ensureSignedIn();
  const snap = await withTimeout(getDoc(doc(db(), 'events', eventId, 'sales', saleId)));
  return snap.exists();
}

export function watchEvent(
  eventId: string,
  onEvent: (e: { name: string; items: Item[]; closedAt: number | null; giftAidOver?: number | null }) => void,
  onSales: (sales: Sale[]) => void,
  onError: (e: Error) => void,
  /** Called with every phone that has joined the event: its till name and opening float. */
  onMembers?: (members: Member[]) => void,
): Unsubscribe {
  const event = doc(db(), 'events', eventId);
  const u1 = onSnapshot(
    event,
    (s) => {
      const d = s.data();
      if (d) onEvent({ name: d.name ?? 'Event', items: d.items ?? [], closedAt: d.closedAt ?? null, giftAidOver: giftAidOverOf(d) });
    },
    onError,
  );
  const u2 = onSnapshot(
    collection(event, 'sales'),
    (s) => onSales(s.docs.map((d) => d.data() as Sale)),
    onError,
  );
  const u3 = onMembers
    ? onSnapshot(
        collection(event, 'members'),
        (s) =>
          onMembers(s.docs.map((d) => toMember(d.data()))),
        onError,
      )
    : undefined;
  return () => {
    u1();
    u2();
    u3?.();
  };
}

/**
 * Every Gift Aid declaration in the event. Only organisers may read them, as they
 * hold donors’ names and addresses; for anyone else the listener reports an error.
 */
export function watchGiftAid(
  eventId: string,
  onDeclarations: (list: GiftAidDeclaration[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db(), 'events', eventId, 'giftAid'),
    (s) =>
      onDeclarations(
        s.docs.map((d) => {
          const { createdBy: _ignored, ...declaration } = d.data() as GiftAidDeclaration & { createdBy?: string };
          return declaration;
        }),
      ),
    onError,
  );
}
