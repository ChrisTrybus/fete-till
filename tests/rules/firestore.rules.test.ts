/**
 * Security rules tests. These need the Firestore emulator (which needs Java):
 *
 *   npm run test:rules
 *
 * Each test seeds data with rules switched off, then checks what a given
 * anonymous user is and isn't allowed to do.
 */
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const EVENT = 'event1';
const CODE = 'ABC234';
const ORGANISER = 'organiser';
const MEMBER = 'member';
const STRANGER = 'stranger';
const OTHER_MEMBER = 'other-member';
const ORGANISER_CODE = 'QRSTUVWX';

const sale = (id: string, createdBy: string, extra: Record<string, unknown> = {}) => ({
  id,
  at: 1700000000000,
  total: 250,
  method: 'cash',
  tendered: 500,
  lines: [{ itemId: 'i1', name: 'Tea', price: 80, qty: 1 }],
  tillName: 'Cake stall',
  deviceId: 'device-1',
  voided: false,
  createdBy,
  ...extra,
});

let env: RulesTestEnvironment;
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-fete-till',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

// An event with a join code, its organiser and two other members, and one sale taken by MEMBER.
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'events', EVENT), {
      name: 'Summer Fete',
      code: CODE,
      createdBy: ORGANISER,
      createdAt: 1700000000000,
      items: [{ id: 'i1', name: 'Tea', price: 80 }],
    });
    await setDoc(doc(db, 'codes', CODE), { eventId: EVENT });
    for (const uid of [ORGANISER, MEMBER, OTHER_MEMBER]) {
      await setDoc(doc(db, 'events', EVENT, 'members', uid), { code: CODE, tillName: uid, joinedAt: 1 });
    }
    await setDoc(doc(db, 'events', EVENT, 'private', 'organiser'), { code: ORGANISER_CODE });
    await setDoc(doc(db, 'events', EVENT, 'organisers', ORGANISER), { code: ORGANISER_CODE, claimedAt: 1 });
    await setDoc(doc(db, 'events', EVENT, 'sales', 'sale1'), sale('sale1', MEMBER));
  });
});

describe('join codes', () => {
  test('a signed-in device can look up a single code', async () => {
    await assertSucceeds(getDoc(doc(as(STRANGER), 'codes', CODE)));
  });

  test('codes cannot be listed', async () => {
    await assertFails(getDocs(collection(as(STRANGER), 'codes')));
    await assertFails(getDocs(collection(as(MEMBER), 'codes')));
  });

  test('a device that is not signed in cannot look up a code', async () => {
    await assertFails(getDoc(doc(anon(), 'codes', CODE)));
  });

  test('only the event creator can reserve a code for it', async () => {
    await assertSucceeds(setDoc(doc(as(ORGANISER), 'codes', 'XYZ789'), { eventId: EVENT }));
    await assertFails(setDoc(doc(as(STRANGER), 'codes', 'HJK456'), { eventId: EVENT }));
    await assertFails(setDoc(doc(as(MEMBER), 'codes', 'HJK457'), { eventId: EVENT }));
  });

  test('a code must be 6 characters', async () => {
    await assertFails(setDoc(doc(as(ORGANISER), 'codes', 'SHORT'), { eventId: EVENT }));
  });

  test('an existing code cannot be repointed or deleted', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'events', 'event2'), { name: 'Other', code: '', createdBy: STRANGER, items: [] }),
    );
    await assertFails(setDoc(doc(as(STRANGER), 'codes', CODE), { eventId: 'event2' }));
    await assertFails(deleteDoc(doc(as(ORGANISER), 'codes', CODE)));
  });
});

describe('events', () => {
  test('non-members cannot read an event', async () => {
    await assertFails(getDoc(doc(as(STRANGER), 'events', EVENT)));
    await assertFails(getDoc(doc(anon(), 'events', EVENT)));
  });

  test('members and the creator can read the event', async () => {
    await assertSucceeds(getDoc(doc(as(MEMBER), 'events', EVENT)));
    await assertSucceeds(getDoc(doc(as(ORGANISER), 'events', EVENT)));
  });

  test('events cannot be listed, even by a member', async () => {
    await assertFails(getDocs(collection(as(MEMBER), 'events')));
  });

  test('a device can create an event only in its own name', async () => {
    const event = { name: 'New', code: '', createdAt: 1, items: [] };
    await assertSucceeds(setDoc(doc(as(STRANGER), 'events', 'mine'), { ...event, createdBy: STRANGER }));
    await assertFails(setDoc(doc(as(STRANGER), 'events', 'forged'), { ...event, createdBy: ORGANISER }));
    await assertFails(setDoc(doc(anon(), 'events', 'anon'), { ...event, createdBy: 'nobody' }));
  });

  test('only an organiser can edit the price list', async () => {
    const items = [{ id: 'i1', name: 'Tea', price: 90 }];
    await assertSucceeds(updateDoc(doc(as(ORGANISER), 'events', EVENT), { items }));
    await assertFails(updateDoc(doc(as(MEMBER), 'events', EVENT), { items }));
    await assertFails(updateDoc(doc(as(STRANGER), 'events', EVENT), { items }));
  });

  test('the creator and the join code are fixed once set', async () => {
    await assertFails(updateDoc(doc(as(ORGANISER), 'events', EVENT), { createdBy: MEMBER }));
    await assertFails(updateDoc(doc(as(ORGANISER), 'events', EVENT), { code: 'ZZZ999' }));
  });

  test('a price list over 200 items is refused', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, name: `Item ${i}`, price: 100 }));
    await assertFails(updateDoc(doc(as(ORGANISER), 'events', EVENT), { items }));
  });

  test('only an organiser can close or reopen the event', async () => {
    await assertFails(updateDoc(doc(as(MEMBER), 'events', EVENT), { closedAt: 1700000001000 }));
    await assertSucceeds(updateDoc(doc(as(ORGANISER), 'events', EVENT), { closedAt: 1700000001000 }));
    await assertFails(updateDoc(doc(as(MEMBER), 'events', EVENT), { closedAt: null }));
    await assertSucceeds(updateDoc(doc(as(ORGANISER), 'events', EVENT), { closedAt: null }));
    await assertFails(updateDoc(doc(as(ORGANISER), 'events', EVENT), { closedAt: 'yesterday' }));
  });

  test('a closed event still accepts sales and voids, so a till with no signal loses nothing', async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'events', EVENT), { closedAt: 1700000001000 }));
    await assertSucceeds(setDoc(doc(as(MEMBER), 'events', EVENT, 'sales', 'late'), sale('late', MEMBER)));
    await assertSucceeds(updateDoc(doc(as(MEMBER), 'events', EVENT, 'sales', 'sale1'), { voided: true, voidedAt: 5 }));
    // The price list can still be corrected too.
    await assertSucceeds(updateDoc(doc(as(ORGANISER), 'events', EVENT), { items: [] }));
  });

  test('a new event can be set up from scratch, the way the app does it', async () => {
    const db = as(STRANGER);
    const event = doc(db, 'events', 'fresh');
    await assertSucceeds(setDoc(event, { name: 'New', code: '', createdBy: STRANGER, createdAt: 1, items: [] }));
    await assertSucceeds(setDoc(doc(event, 'private', 'organiser'), { code: 'HJKMNPQR' }));
    await assertSucceeds(setDoc(doc(event, 'organisers', STRANGER), { code: 'HJKMNPQR', claimedAt: 1 }));
    await assertSucceeds(setDoc(doc(db, 'codes', 'NEW234'), { eventId: 'fresh' }));
    await assertSucceeds(updateDoc(event, { code: 'NEW234' }));
    await assertSucceeds(setDoc(doc(event, 'members', STRANGER), { code: 'NEW234', tillName: 'Till 1', joinedAt: 1 }));
  });

  test('an event cannot be deleted', async () => {
    await assertFails(deleteDoc(doc(as(ORGANISER), 'events', EVENT)));
  });
});

describe('members', () => {
  test('a device joins by writing its own member doc with the right code', async () => {
    await assertSucceeds(
      setDoc(doc(as(STRANGER), 'events', EVENT, 'members', STRANGER), { code: CODE, tillName: 'Tombola', joinedAt: 2 }),
    );
    // ...after which it can read the event and its sales.
    await assertSucceeds(getDoc(doc(as(STRANGER), 'events', EVENT)));
    await assertSucceeds(getDocs(collection(as(STRANGER), 'events', EVENT, 'sales')));
  });

  test('joining needs a code that maps to this event', async () => {
    const member = doc(as(STRANGER), 'events', EVENT, 'members', STRANGER);
    await assertFails(setDoc(member, { code: 'WRONG1', tillName: 'Tombola', joinedAt: 2 }));
    await assertFails(setDoc(member, { tillName: 'Tombola', joinedAt: 2 }));

    // A valid code for a different event doesn't open this one.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'events', 'event2'), { name: 'Other', code: 'QRS567', createdBy: STRANGER, items: [] });
      await setDoc(doc(ctx.firestore(), 'codes', 'QRS567'), { eventId: 'event2' });
    });
    await assertFails(setDoc(member, { code: 'QRS567', tillName: 'Tombola', joinedAt: 2 }));
  });

  test('a device cannot add or rename another device as a member', async () => {
    await assertFails(
      setDoc(doc(as(STRANGER), 'events', EVENT, 'members', 'someone-else'), { code: CODE, tillName: 'x', joinedAt: 2 }),
    );
    await assertFails(
      setDoc(doc(as(MEMBER), 'events', EVENT, 'members', ORGANISER), { code: CODE, tillName: 'hijacked', joinedAt: 2 }),
    );
  });

  test('a member can rename its own till', async () => {
    await assertSucceeds(
      setDoc(doc(as(MEMBER), 'events', EVENT, 'members', MEMBER), { code: CODE, tillName: 'Plants', joinedAt: 3 }),
    );
  });

  test('a member can set its own float, as whole pence that is not negative', async () => {
    const member = doc(as(MEMBER), 'events', EVENT, 'members', MEMBER);
    const base = { code: CODE, tillName: 'Plants', joinedAt: 3, deviceId: 'device-1' };
    await assertSucceeds(setDoc(member, { ...base, float: 2000 }));
    await assertSucceeds(setDoc(member, { ...base, float: 0 }));
    await assertFails(setDoc(member, { ...base, float: -500 }));
    await assertFails(setDoc(member, { ...base, float: 12.5 }));
    await assertFails(setDoc(member, { ...base, float: '2000' }));
    // Nobody can set another till's float.
    await assertFails(setDoc(doc(as(ORGANISER), 'events', EVENT, 'members', MEMBER), { ...base, float: 2000 }));
  });

  test('only members can see the member list', async () => {
    await assertSucceeds(getDocs(collection(as(MEMBER), 'events', EVENT, 'members')));
    await assertFails(getDocs(collection(as(STRANGER), 'events', EVENT, 'members')));
  });

  test('a member cannot be removed', async () => {
    await assertFails(deleteDoc(doc(as(ORGANISER), 'events', EVENT, 'members', MEMBER)));
  });
});

describe('organisers', () => {
  const claim = (uid: string, code: unknown) =>
    setDoc(doc(as(uid), 'events', EVENT, 'organisers', uid), { code, claimedAt: 2 });

  test('a device becomes an organiser by presenting the organiser code', async () => {
    await assertSucceeds(claim(MEMBER, ORGANISER_CODE));
    // ...after which it can edit the price list.
    await assertSucceeds(updateDoc(doc(as(MEMBER), 'events', EVENT), { items: [] }));
  });

  test('a wrong or missing code is refused', async () => {
    await assertFails(claim(MEMBER, 'WRONGWRO'));
    await assertFails(claim(MEMBER, CODE)); // the join code is not enough
    await assertFails(claim(MEMBER, null));
    await assertFails(setDoc(doc(as(MEMBER), 'events', EVENT, 'organisers', MEMBER), { claimedAt: 2 }));
  });

  test('a device cannot make another device an organiser', async () => {
    await assertFails(
      setDoc(doc(as(ORGANISER), 'events', EVENT, 'organisers', MEMBER), { code: ORGANISER_CODE, claimedAt: 2 }),
    );
  });

  test('an organiser can re-claim the role, as the app does on each launch', async () => {
    await assertSucceeds(claim(ORGANISER, ORGANISER_CODE));
  });

  test('nobody can read the organiser code back', async () => {
    const secret = (uid: string) => doc(as(uid), 'events', EVENT, 'private', 'organiser');
    await assertFails(getDoc(secret(MEMBER)));
    await assertFails(getDoc(secret(ORGANISER)));
    await assertFails(getDocs(collection(as(MEMBER), 'events', EVENT, 'private')));
    // Other devices' claims carry the code too, so they are hidden as well.
    await assertFails(getDoc(doc(as(MEMBER), 'events', EVENT, 'organisers', ORGANISER)));
    await assertFails(getDocs(collection(as(MEMBER), 'events', EVENT, 'organisers')));
    await assertFails(getDocs(collection(as(ORGANISER), 'events', EVENT, 'organisers')));
  });

  test('the organiser code cannot be changed or removed once set', async () => {
    const secret = doc(as(ORGANISER), 'events', EVENT, 'private', 'organiser');
    await assertFails(setDoc(secret, { code: 'HJKMNPQR' }));
    await assertFails(deleteDoc(secret));
  });

  test('only the event creator can set the organiser code, and it must be 8 characters', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'events', 'event2'), { name: 'Other', code: '', createdBy: STRANGER, items: [] }),
    );
    const secret = (uid: string) => doc(as(uid), 'events', 'event2', 'private', 'organiser');
    await assertFails(setDoc(secret(MEMBER), { code: 'HJKMNPQR' }));
    await assertFails(setDoc(secret(STRANGER), { code: 'SHORT' }));
    await assertFails(setDoc(doc(as(STRANGER), 'events', 'event2', 'private', 'other'), { code: 'HJKMNPQR' }));
    await assertSucceeds(setDoc(secret(STRANGER), { code: 'HJKMNPQR' }));
  });

  test('an organiser role cannot be removed', async () => {
    await assertFails(deleteDoc(doc(as(ORGANISER), 'events', EVENT, 'organisers', ORGANISER)));
  });
});

describe('sales', () => {
  const saleRef = (uid: string, id: string) => doc(as(uid), 'events', EVENT, 'sales', id);

  test('non-members cannot read or add sales', async () => {
    await assertFails(getDocs(collection(as(STRANGER), 'events', EVENT, 'sales')));
    await assertFails(getDoc(saleRef(STRANGER, 'sale1')));
    await assertFails(setDoc(saleRef(STRANGER, 'sale2'), sale('sale2', STRANGER)));
  });

  test('a member can add a sale and read every till’s sales', async () => {
    await assertSucceeds(setDoc(saleRef(MEMBER, 'sale2'), sale('sale2', MEMBER)));
    await assertSucceeds(getDocs(collection(as(ORGANISER), 'events', EVENT, 'sales')));
  });

  test('a sale must carry its own id and the sender’s user id', async () => {
    await assertFails(setDoc(saleRef(MEMBER, 'sale2'), sale('different-id', MEMBER)));
    await assertFails(setDoc(saleRef(MEMBER, 'sale2'), sale('sale2', ORGANISER)));
  });

  test('a sale total must be a whole, non-negative number of pence', async () => {
    await assertFails(setDoc(saleRef(MEMBER, 'sale2'), sale('sale2', MEMBER, { total: -100 })));
    await assertFails(setDoc(saleRef(MEMBER, 'sale3'), sale('sale3', MEMBER, { total: 1.5 })));
    await assertFails(setDoc(saleRef(MEMBER, 'sale4'), sale('sale4', MEMBER, { total: '250' })));
  });

  test('a sale cannot be edited', async () => {
    await assertFails(updateDoc(saleRef(MEMBER, 'sale1'), { total: 1 }));
    await assertFails(updateDoc(saleRef(MEMBER, 'sale1'), { lines: [] }));
    await assertFails(updateDoc(saleRef(MEMBER, 'sale1'), { tillName: 'Someone else' }));
    await assertFails(updateDoc(saleRef(ORGANISER, 'sale1'), { method: 'card' }));
    // Overwriting with a different sale under the same id is an edit too.
    await assertFails(setDoc(saleRef(MEMBER, 'sale1'), sale('sale1', MEMBER, { total: 1 })));
  });

  test('a till can void and restore its own sale, alongside nothing else', async () => {
    await assertSucceeds(updateDoc(saleRef(MEMBER, 'sale1'), { voided: true, voidedAt: 5 }));
    await assertSucceeds(updateDoc(saleRef(MEMBER, 'sale1'), { voided: false, voidedAt: 6 }));
    await assertFails(updateDoc(saleRef(MEMBER, 'sale1'), { voided: true, total: 0 }));
  });

  test('only an organiser can void or restore another till’s sale', async () => {
    await assertFails(updateDoc(saleRef(OTHER_MEMBER, 'sale1'), { voided: true, voidedAt: 5 }));
    await assertFails(updateDoc(saleRef(STRANGER, 'sale1'), { voided: true, voidedAt: 5 }));
    await assertSucceeds(updateDoc(saleRef(ORGANISER, 'sale1'), { voided: true, voidedAt: 5 }));
    await assertSucceeds(updateDoc(saleRef(ORGANISER, 'sale1'), { voided: false, voidedAt: 6 }));
    await assertFails(updateDoc(saleRef(ORGANISER, 'sale1'), { voided: true, total: 0 }));
  });

  test('resending an identical sale is accepted, so retries are safe', async () => {
    await assertSucceeds(setDoc(saleRef(MEMBER, 'sale1'), sale('sale1', MEMBER)));
  });

  test('a sale cannot be deleted', async () => {
    await assertFails(deleteDoc(saleRef(MEMBER, 'sale1')));
    await assertFails(deleteDoc(saleRef(ORGANISER, 'sale1')));
  });
});

describe('Gift Aid declarations', () => {
  const ref = (uid: string, id: string) => doc(as(uid), 'events', EVENT, 'giftAid', id);
  const declaration = (saleId: string, createdBy: string, extra: Record<string, unknown> = {}) => ({
    saleId,
    at: 1700000000000,
    amount: 500,
    firstName: 'Ada',
    lastName: 'Lovelace',
    house: '12',
    postcode: 'SW1A 1AA',
    tillName: 'Cake stall',
    deviceId: 'device-1',
    createdBy,
    ...extra,
  });

  test('any till can add one, but only an organiser can read them back', async () => {
    await assertSucceeds(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', MEMBER)));
    await assertFails(getDoc(ref(MEMBER, 'sale1')));
    await assertFails(getDocs(collection(as(OTHER_MEMBER), 'events', EVENT, 'giftAid')));
    await assertSucceeds(getDoc(ref(ORGANISER, 'sale1')));
    await assertSucceeds(getDocs(collection(as(ORGANISER), 'events', EVENT, 'giftAid')));
  });

  test('non-members can neither add nor read them', async () => {
    await assertFails(setDoc(ref(STRANGER, 'sale1'), declaration('sale1', STRANGER)));
    await assertFails(getDocs(collection(as(STRANGER), 'events', EVENT, 'giftAid')));
  });

  test('a declaration must carry its own sale id, the sender’s id, and only the expected fields', async () => {
    await assertFails(setDoc(ref(MEMBER, 'sale1'), declaration('other-sale', MEMBER)));
    await assertFails(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', ORGANISER)));
    await assertFails(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', MEMBER, { email: 'ada@example.com' })));
  });

  test('the amount and the donor’s details must be filled in and within HMRC’s lengths', async () => {
    await assertFails(setDoc(ref(MEMBER, 'a'), declaration('a', MEMBER, { amount: 0 })));
    await assertFails(setDoc(ref(MEMBER, 'b'), declaration('b', MEMBER, { amount: 2.5 })));
    await assertFails(setDoc(ref(MEMBER, 'c'), declaration('c', MEMBER, { firstName: '' })));
    await assertFails(setDoc(ref(MEMBER, 'd'), declaration('d', MEMBER, { lastName: 'x'.repeat(36) })));
    await assertFails(setDoc(ref(MEMBER, 'e'), declaration('e', MEMBER, { house: '' })));
    await assertFails(setDoc(ref(MEMBER, 'f'), declaration('f', MEMBER, { postcode: 'NOT A POSTCODE' })));
  });

  test('resending the same declaration is accepted, but changing one is not', async () => {
    await assertSucceeds(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', MEMBER)));
    await assertSucceeds(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', MEMBER)));
    // After a restart the phone may have a new sign-in; the same declaration still goes through.
    await assertSucceeds(setDoc(ref(OTHER_MEMBER, 'sale1'), declaration('sale1', OTHER_MEMBER)));
    await assertFails(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', MEMBER, { postcode: 'EC1A 1BB' })));
    await assertFails(updateDoc(ref(ORGANISER, 'sale1'), { amount: 1 }));
  });

  test('a declaration cannot be deleted', async () => {
    await assertSucceeds(setDoc(ref(MEMBER, 'sale1'), declaration('sale1', MEMBER)));
    await assertFails(deleteDoc(ref(MEMBER, 'sale1')));
    await assertFails(deleteDoc(ref(ORGANISER, 'sale1')));
  });
});
