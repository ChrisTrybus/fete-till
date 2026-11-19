// Firestore layout (see firestore.rules for who can do what):
//   codes/{CODE}                      { eventId }            join code -> event lookup
//   events/{eventId}                  { name, code, createdBy, createdAt, items[], closedAt?, giftAidOver?, account?, paid? }
//   events/{eventId}/members/{uid}    { code, tillName, joinedAt, deviceId?, float? }
//   events/{eventId}/private/organiser { code }             organiser code; no device can read it
//   events/{eventId}/organisers/{uid} { code, claimedAt }   devices that have proved they know it
//   events/{eventId}/sales/{saleId}   Sale + { createdBy }
//   events/{eventId}/giftAid/{saleId} GiftAidDeclaration + { createdBy }   only organisers can read these
// Events, their codes and organiser codes are made by the server: see functions/src/index.ts.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ensureSignedIn, getAccountAuth, getCloud, getEventFunctions } from './firebase';
import { isSaleRecord } from './sale-record';
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

/** The event as the server made it. Its name and price list are the server's, which may be from an earlier try. */
type Started = { eventId: string; code: string; organiserCode: string; name?: string; items?: Item[] };

// The id of a shared event this phone has asked the server for but not heard back
// about. It is kept on the phone until the answer arrives, so that trying again,
// even after closing the app, asks for the same event: if the server made it the
// first time, it is returned, rather than a second one made and paid for.
const PENDING_KEY = 'fete-till:pending-shared-event';
const PENDING_FOR = 24 * 60 * 60 * 1000;

async function pendingEventId(): Promise<string | null> {
  try {
    const p = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? 'null') as { eventId?: unknown; at?: unknown } | null;
    if (p && typeof p.eventId === 'string' && typeof p.at === 'number' && Date.now() - p.at < PENDING_FOR) return p.eventId;
  } catch {
    // Unreadable: start afresh.
  }
  return null;
}

const forgetPending = () => AsyncStorage.removeItem(PENDING_KEY).catch(() => {});

/**
 * Starts a shared event, with this phone as its organiser and first till. The server
 * makes it (functions/src/index.ts), so that it can spend an event pack credit from
 * the signed-in account. The event id is picked here and kept until the server
 * answers, so trying again after a lost reply returns the same event instead of
 * spending a second credit.
 */
export async function createEvent(name: string, tillName: string, items: Item[], deviceId?: string): Promise<Started> {
  await ensureSignedIn();
  const functions = getEventFunctions();
  if (!functions) throw new Error('Cloud sync is not configured');
  let eventId = await pendingEventId();
  if (!eventId) {
    eventId = doc(collection(db(), 'events')).id;
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ eventId, at: Date.now() }));
  }
  const start = httpsCallable<object, Started>(functions, 'startSharedEvent', { timeout: 20000 });

  for (let attempt = 0; ; attempt++) {
    // Fetched each time: a token can expire between tries.
    const accountToken = (await getAccountAuth()?.currentUser?.getIdToken()) ?? null;
    try {
      const { data } = await start({ eventId, name, tillName, items, deviceId: deviceId ?? null, accountToken });
      await forgetPending();
      return data;
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const reason = ((e as { details?: { reason?: unknown } }).details?.reason ?? null) as string | null;
      // A clear answer that this event wasn't made: the next try can use a new id.
      if (code === 'functions/failed-precondition' && (reason === 'sign-in' || reason === 'no-credits')) {
        await forgetPending();
        throw new NeedsPack((e as Error).message, reason);
      }
      if (code === 'functions/invalid-argument' || code === 'functions/already-exists') {
        await forgetPending();
        throw new Error(code === 'functions/already-exists' ? 'That didn’t work. Try again.' : (e as Error).message);
      }
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

const toMember = (m: DocumentData, uid: string, isLocal: boolean): Member => {
  return {
    deviceId: typeof m.deviceId === 'string' ? m.deviceId : '',
    tillName: typeof m.tillName === 'string' ? m.tillName : '',
    float: typeof m.float === 'number' && Number.isSafeInteger(m.float) && m.float > 0 ? m.float : 0,
    isLocal,
    uid,
  };
};

/**
 * Joins an event by its code and restores the current member's opening float.
 */
export async function joinEvent(rawCode: string, tillName: string, deviceId?: string): Promise<{
  eventId: string; code: string; eventName: string; items: Item[]; float: number; giftAidOver: number | null; memberUid?: string;
}> {
  await ensureSignedIn();
  const code = normaliseCode(rawCode);
  const codeSnap = await withTimeout(getDoc(doc(db(), 'codes', code)));
  if (!codeSnap.exists()) throw new Error(`No event found with code ${code}. Check the code and try again.`);
  const eventId = codeSnap.data().eventId as string;
  const registered = await joinAsMember(eventId, code, tillName, { deviceId: deviceId ?? '' });
  const eventSnap = await withTimeout(getDoc(doc(db(), 'events', eventId)));
  const data = eventSnap.data() ?? {};

  return { eventId, code, eventName: (data.name as string) ?? 'Event', items: (data.items as Item[]) ?? [], float: registered.float, giftAidOver: giftAidOverOf(data), memberUid: registered.uid };
}

/** The event's Gift Aid setting: null (declarations off) unless it holds a sensible amount. */
const giftAidOverOf = (d: DocumentData): number | null =>
  typeof d.giftAidOver === 'number' && d.giftAidOver >= 0 ? d.giftAidOver : null;

const recoveryKeys = new Map<string, Promise<string>>();

function tillRecoveryKey(eventId: string): Promise<string> {
  const pending = recoveryKeys.get(eventId);
  if (pending) return pending;
  const load = (async () => {
    const storageKey = `fetetill:till-recovery:${eventId}`;
    const saved = await AsyncStorage.getItem(storageKey);
    if (saved) return saved;
    const key = randomUUID() + randomUUID();
    await AsyncStorage.setItem(storageKey, key);
    return key;
  })().finally(() => recoveryKeys.delete(eventId));
  recoveryKeys.set(eventId, load);
  return load;
}

/** Rejoins the till and recovers its opening float even if Firebase issued a new UID. */
export async function joinAsMember(eventId: string, code: string, tillName: string, till: { deviceId: string; float?: number }) {
  await ensureSignedIn();
  const functions = getEventFunctions();
  if (!functions) throw new Error('Cloud sync is not configured');
  const recoveryKey = await tillRecoveryKey(eventId);
  const register = httpsCallable<object, { float: number; uid: string }>(functions, 'registerTill', { timeout: 10000 });
  const { data } = await register({ eventId, code, tillName, recoveryKey, ...till });
  return data;
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
    case 'giftAid': {
      const functions = getEventFunctions();
      if (!functions) throw new Error('Cloud sync is not configured');
      await httpsCallable(functions, 'submitGiftAid', { timeout: 10000 })({ eventId, declaration: op.declaration });
      break;
    }
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
    (s) => onSales(s.docs.flatMap((d) => {
      const sale = d.data();
      return isSaleRecord(sale) && sale.id === d.id ? [sale] : [];
    })),
    onError,
  );
  const u3 = onMembers
    ? onSnapshot(
        collection(event, 'members'),
        (s) => {
          const uid = getCloud()?.auth.currentUser?.uid;
          onMembers(s.docs.flatMap((d) => {
            const member = d.data();
            return member.superseded === true ? [] : [toMember(member, d.id, d.id === uid)];
          }));
        },
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
        s.docs.map((d) => d.data() as GiftAidDeclaration),
      ),
    onError,
  );
}
