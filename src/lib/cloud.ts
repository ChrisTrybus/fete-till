// Firestore layout (see firestore.rules for who can do what):
//   codes/{CODE}                      { eventId }            join code -> event lookup
//   events/{eventId}                  { name, code, createdBy, createdAt, items[] }
//   events/{eventId}/members/{uid}    { code, tillName, joinedAt }
//   events/{eventId}/sales/{saleId}   Sale + { createdBy }
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { ensureSignedIn, getCloud } from './firebase';
import type { Item, OutboxOp, Sale } from './types';

// No 0/O, 1/I/L so codes are easy to read aloud and type.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const randomCode = (len = 6) =>
  Array.from({ length: len }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');

export const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

function db() {
  const c = getCloud();
  if (!c) throw new Error('Cloud sync is not configured');
  return c.db;
}

/** Waits for a Firestore write, but gives up after `ms`. Offline writes stay queued in the SDK either way. */
const withTimeout = <T,>(p: Promise<T>, ms = 10000) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

export async function createEvent(name: string, tillName: string, items: Item[]) {
  const uid = await ensureSignedIn();
  const ref = doc(collection(db(), 'events'));
  await withTimeout(setDoc(ref, { name, code: '', createdBy: uid, createdAt: Date.now(), items }));

  // Reserve a unique code. Creating an existing code doc counts as an update,
  // which the rules refuse, so a clash just means "try another".
  let code = '';
  for (let attempt = 0; attempt < 5 && !code; attempt++) {
    const candidate = randomCode();
    try {
      await withTimeout(setDoc(doc(db(), 'codes', candidate), { eventId: ref.id }));
      code = candidate;
    } catch (e) {
      if (attempt === 4) throw e;
    }
  }
  await withTimeout(updateDoc(ref, { code }));
  await joinAsMember(ref.id, code, tillName);
  return { eventId: ref.id, code };
}

export async function joinEvent(rawCode: string, tillName: string) {
  await ensureSignedIn();
  const code = normaliseCode(rawCode);
  const codeSnap = await withTimeout(getDoc(doc(db(), 'codes', code)));
  if (!codeSnap.exists()) throw new Error(`No event found with code ${code}. Check the code and try again.`);
  const eventId = codeSnap.data().eventId as string;
  await joinAsMember(eventId, code, tillName);
  const eventSnap = await withTimeout(getDoc(doc(db(), 'events', eventId)));
  const data = eventSnap.data() ?? {};
  return { eventId, code, eventName: (data.name as string) ?? 'Event', items: (data.items as Item[]) ?? [] };
}

/** (Re)registers this device's anonymous user as a member. Safe to call on every launch. */
export async function joinAsMember(eventId: string, code: string, tillName: string) {
  const uid = await ensureSignedIn();
  await withTimeout(
    setDoc(doc(db(), 'events', eventId, 'members', uid), { code, tillName, joinedAt: Date.now() }),
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
  onEvent: (e: { name: string; items: Item[] }) => void,
  onSales: (sales: Sale[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const event = doc(db(), 'events', eventId);
  const u1 = onSnapshot(
    event,
    (s) => {
      const d = s.data();
      if (d) onEvent({ name: d.name ?? 'Event', items: d.items ?? [] });
    },
    onError,
  );
  const u2 = onSnapshot(
    collection(event, 'sales'),
    (s) => onSales(s.docs.map((d) => d.data() as Sale)),
    onError,
  );
  return () => {
    u1();
    u2();
  };
}
