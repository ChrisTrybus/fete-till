// Cash Tin's server code: event packs and starting shared events.
//
//   accounts/{uid}                    { credits, unlocked, updatedAt }   written only here
//   accounts/{uid}/purchases/{txId}   one per pack bought (RevenueCat's transaction id)
//   accounts/{uid}/spent/{eventId}    one per shared event that used a credit
//
// Purchases are made in the app through RevenueCat, with the account's uid as
// RevenueCat's app user id. The app then calls syncPurchases, which asks
// RevenueCat what that account has bought and adds any pack not counted yet.
// Nothing the app says about a purchase is trusted.
//
// Shared events are only made here (the rules stop devices making them), so a
// credit can be required and spent in the same transaction that makes the event.
import { randomInt } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type DocumentReference, type Transaction } from 'firebase-admin/firestore';
import { setGlobalOptions } from 'firebase-functions';
import { HttpsError, onCall, type CallableRequest } from 'firebase-functions/https';
import { logger } from 'firebase-functions';
import { defineBoolean, defineSecret } from 'firebase-functions/params';
import { makeCode, packPurchases, readEventRequest } from './packs';
import { giftAidDonation, readGiftAidRequest } from './gift-aid';

initializeApp();
setGlobalOptions({ region: 'europe-west2', maxInstances: 10 });

const REVENUECAT_SECRET_KEY = defineSecret('REVENUECAT_SECRET_KEY');
const REQUIRE_CREDITS = defineBoolean('REQUIRE_CREDITS', {
  default: false,
  description: 'Starting a shared event needs an event pack credit. Leave off until packs are on sale in the stores.',
});
const ALLOW_SANDBOX_PURCHASES = defineBoolean('ALLOW_SANDBOX_PURCHASES', {
  default: false,
  description: 'Count test purchases (TestFlight, Play testing) as real credits. Turn off once the app is live.',
});

const db = () => getFirestore();

async function reserveCall(tx: Transaction, operation: string, uid: string, limit: number, windowMs: number) {
  const ref = db().collection('callableLimits').doc(operation).collection('callers').doc(uid);
  const snap = await tx.get(ref);
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const count = snap.get('window') === window ? Number(snap.get('count')) : 0;
  if (count >= limit) throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
  return () => tx.set(ref, { window, count: count + 1 });
}

async function limitCalls(operation: string, uid: string, perMinute: number) {
  await db().runTransaction(async (tx) => {
    const commitLimit = await reserveCall(tx, operation, uid, perMinute, 60_000);
    commitLimit();
  });
}

/** The caller's uid, refusing an anonymous sign-in, which is a phone's event user rather than an account. */
function accountUid(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in to your Cash Tin account first.', { reason: 'sign-in' });
  if (req.auth.token.firebase?.sign_in_provider === 'anonymous') {
    throw new HttpsError('permission-denied', 'Sign in to your Cash Tin account first.', { reason: 'sign-in' });
  }
  return req.auth.uid;
}

/** Counts any packs this account has bought that aren't on it yet. */
export const syncPurchases = onCall({ secrets: [REVENUECAT_SECRET_KEY] }, async (req) => {
  const uid = accountUid(req);
  await limitCalls('syncPurchases', uid, 6);

  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${REVENUECAT_SECRET_KEY.value()}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    logger.error('RevenueCat lookup failed', { status: res.status });
    throw new HttpsError('unavailable', 'Couldn’t check your purchases. Try again in a minute.');
  }
  const body = (await res.json()) as { subscriber?: { non_subscriptions?: unknown } };
  const bought = packPurchases(body.subscriber?.non_subscriptions, ALLOW_SANDBOX_PURCHASES.value());

  const account = db().doc(`accounts/${uid}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(account);
    const seen = bought.length
      ? await tx.getAll(...bought.map((b) => account.collection('purchases').doc(b.id)))
      : [];
    const added = bought.filter((_, i) => !seen[i].exists);
    const credits = (Number(snap.get('credits')) || 0) + added.reduce((n, b) => n + b.credits, 0);
    const unlocked = snap.get('unlocked') === true || bought.length > 0;

    for (const b of added) {
      tx.create(account.collection('purchases').doc(b.id), { ...b, countedAt: FieldValue.serverTimestamp() });
    }
    if (added.length || unlocked !== (snap.get('unlocked') === true) || !snap.exists) {
      tx.set(account, { credits, unlocked, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    return { credits, unlocked, added: added.reduce((n, b) => n + b.credits, 0) };
  });
});

/**
 * Starts a shared event for the calling phone, which becomes its organiser and
 * first till. Called with the phone's anonymous event user; `accountToken` is the
 * Cash Tin account's id token, whose credit pays for it.
 *
 * The app picks the event id, so a retry after a lost reply finds the event
 * already made and returns it, rather than spending a second credit.
 */
export const startSharedEvent = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Not signed in.');
  const phone = req.auth.uid;
  const r = readEventRequest(req.data);
  if (typeof r === 'string') throw new HttpsError('invalid-argument', r);
  await limitCalls('startSharedEvent', phone, 30);

  const event = db().doc(`events/${r.eventId}`);
  const organiserDoc = event.collection('private').doc('organiser');

  const requireCredits = REQUIRE_CREDITS.value();
  let payer: string | null = null;
  if (r.accountToken) {
    try {
      const t = await getAuth().verifyIdToken(r.accountToken);
      if (t.firebase?.sign_in_provider !== 'anonymous') payer = t.uid;
    } catch {
      // An expired or bad token. Only a problem if a credit is needed.
    }
  }
  if (requireCredits && !payer) {
    throw new HttpsError('failed-precondition', 'Sign in to your Cash Tin account to start an event with several tills.', {
      reason: 'sign-in',
    });
  }

  return db().runTransaction(async (tx) => {
    const existing = await tx.get(event);
    if (existing.exists) {
      if (existing.get('createdBy') !== phone) throw new HttpsError('already-exists', 'That event id is taken.');
      // An earlier try made it (its reply was lost). Return it as it was made.
      const secret = await tx.get(organiserDoc);
      return {
        eventId: r.eventId,
        code: String(existing.get('code')),
        organiserCode: String(secret.get('code')),
        name: String(existing.get('name')),
        items: existing.get('items') ?? [],
      };
    }

    const account: DocumentReference | null = requireCredits && payer ? db().doc(`accounts/${payer}`) : null;
    if (account) {
      const credits = Number((await tx.get(account)).get('credits')) || 0;
      if (credits < 1) {
        throw new HttpsError('failed-precondition', 'You need an event pack to start an event with several tills.', {
          reason: 'no-credits',
        });
      }
    }
    const commitLimit = account ? null : await reserveCall(tx, 'freeSharedEvents', phone, 20, 3_600_000);

    // A join code nobody is using. Five tries at 31^6 codes each is plenty.
    const candidates = Array.from({ length: 5 }, () => makeCode(6, randomInt));
    const taken = await tx.getAll(...candidates.map((c) => db().doc(`codes/${c}`)));
    const code = candidates.find((_, i) => !taken[i].exists);
    if (!code) throw new HttpsError('resource-exhausted', 'Couldn’t find a free join code. Try again.');
    const organiserCode = makeCode(8, randomInt);
    const now = Date.now();

    commitLimit?.();
    tx.create(event, {
      name: r.name,
      code,
      createdBy: phone,
      createdAt: now,
      items: r.items,
      ...(payer ? { account: payer } : {}),
      ...(account ? { paid: true } : {}),
    });
    tx.create(db().doc(`codes/${code}`), { eventId: r.eventId });
    tx.create(organiserDoc, { code: organiserCode });
    tx.create(event.collection('organisers').doc(phone), { code: organiserCode, claimedAt: now });
    tx.create(event.collection('members').doc(phone), {
      code,
      tillName: r.tillName,
      joinedAt: now,
      ...(r.deviceId ? { deviceId: r.deviceId } : {}),
    });
    if (account) {
      tx.update(account, { credits: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() });
      tx.create(account.collection('spent').doc(r.eventId), { eventName: r.name, at: now });
    }
    return { eventId: r.eventId, code, organiserCode, name: r.name, items: r.items };
  });
});

export const submitGiftAid = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Not signed in.');
  const parsed = readGiftAidRequest(req.data);
  if (!parsed) throw new HttpsError('invalid-argument', 'Check the Gift Aid declaration.');
  await limitCalls('submitGiftAid', uid, 180);
  const { eventId, saleId, ...details } = parsed;
  const event = db().collection('events').doc(eventId);
  const declaration = event.collection('giftAid').doc(saleId);
  return db().runTransaction(async (tx) => {
    const [member, sale, existing] = await tx.getAll(
      event.collection('members').doc(uid), event.collection('sales').doc(saleId), declaration,
    );
    const donation = giftAidDonation(sale.data() ?? {}, uid);
    if (!member.exists || !donation) throw new HttpsError('permission-denied', 'The declaration must match a donation taken by this till.');
    const record = { saleId, ...details, ...donation, createdBy: uid };
    if (existing.exists) {
      // The original write might have succeeded before its reply reached the till.
      if (Object.entries(record).every(([key, value]) => existing.get(key) === value)) return;
      throw new HttpsError('already-exists', 'This sale already has a Gift Aid declaration.');
    }
    tx.create(declaration, record);
  });
});
