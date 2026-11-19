// Cash Tin accounts: a real sign-in (email and password, Google, or Apple) that will hold
// event credits and saved price lists, which have to survive a reinstall.
//
// An account is not how a phone takes part in an event. Events use each phone's own
// anonymous user, on the default Firebase app, and an event's membership, organiser role
// and own sales are held against that user's id. Accounts sign in on a second Firebase
// app (see getAccountAuth), so signing in, out, or to an account another phone uses never
// changes a phone's place in an event, and two phones on one account are still two tills.
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { useSyncExternalStore } from 'react';
import { AccountError, providerErrorMessage } from './account-errors';
import { availableProviders, connectProvider, signOutProviders, type Provider } from './account-providers';
import { cloudEnabled, getAccountAuth } from './firebase';
import { forgetBuyer } from './store-purchases';

export { availableProviders, type Provider };

export type SignInMethod = 'password' | Provider;

export type Account = {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  /** How this account can sign in. */
  methods: SignInMethod[];
};

const METHOD_OF: Record<string, SignInMethod> = { password: 'password', 'google.com': 'google', 'apple.com': 'apple' };

export const MIN_PASSWORD = 8;

/** The signed-in account, or null for nobody. */
export function toAccount(u: User | null): Account | null {
  if (!u || u.isAnonymous) return null;
  const methods = u.providerData.map((p) => METHOD_OF[p.providerId]).filter((m): m is SignInMethod => Boolean(m));
  return {
    uid: u.uid,
    email: u.email,
    name: u.displayName,
    // Google and Apple have checked the address themselves.
    emailVerified: u.emailVerified || methods.some((m) => m !== 'password'),
    methods: [...new Set(methods)],
  };
}

// ---- Watching the signed-in account ------------------------------------------------

type Snapshot = { ready: boolean; account: Account | null };
let snapshot: Snapshot = { ready: !cloudEnabled, account: null };
const listeners = new Set<() => void>();
let watching = false;

/** Re-reads the current user. Changes to a user (a new name, a confirmed email) don't fire Firebase's listener. */
function refresh() {
  const next: Snapshot = { ready: true, account: toAccount(getAccountAuth()?.currentUser ?? null) };
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const a = getAccountAuth();
  if (!watching && a) {
    watching = true;
    onAuthStateChanged(a, refresh);
  }
  return () => {
    listeners.delete(listener);
  };
}

/** The signed-in account. `ready` is false until Firebase has restored any saved sign-in. */
export function useAccount(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

// ---- Signing in and out ------------------------------------------------------------

function auth(): Auth {
  const a = getAccountAuth();
  if (!a) throw new AccountError('Accounts aren’t set up in this version of the app.');
  return a;
}

function signedOut(a: Auth) {
  if (a.currentUser) throw new AccountError('You’re already signed in. Sign out first to use another account.');
}

/** Signs in with Google or Apple, making the account if it is new. Resolves false if the person cancelled. */
export async function signInWithProvider(provider: Provider): Promise<boolean> {
  const a = auth();
  signedOut(a);
  try {
    return await connectProvider(a, provider);
  } catch (e) {
    const message = providerErrorMessage(e, provider);
    if (message === null) throw e; // cancelled: nothing to show
    console.warn(`${provider} sign-in failed`, e);
    throw new AccountError(message);
  } finally {
    refresh();
  }
}

const cleanEmail = (email: string) => email.trim();

/** Makes a new account with an email and password, and sends a link to confirm the address. */
export async function createEmailAccount(email: string, password: string) {
  if (password.length < MIN_PASSWORD) throw new AccountError(`Use a password of at least ${MIN_PASSWORD} characters.`);
  const a = auth();
  signedOut(a);
  try {
    const result = await createUserWithEmailAndPassword(a, cleanEmail(email), password);
    await sendEmailVerification(result.user).catch(() => {});
  } finally {
    refresh();
  }
}

/** Signs in to an existing email account. */
export async function signInWithEmail(email: string, password: string) {
  const a = auth();
  signedOut(a);
  await signInWithEmailAndPassword(a, cleanEmail(email), password);
  refresh();
}

export async function sendPasswordReset(email: string) {
  if (!cleanEmail(email)) throw new AccountError('Type your email address first.');
  await sendPasswordResetEmail(auth(), cleanEmail(email));
}

export async function resendVerification() {
  const u = auth().currentUser;
  if (u) await sendEmailVerification(u);
}

/** Fetches the account again, e.g. to see that its email has been confirmed. */
export async function reloadAccount() {
  await auth().currentUser?.reload();
  refresh();
}

/** Signs out. Any event the phone is in carries on as before. */
export async function signOutAccount() {
  await signOut(auth());
  await signOutProviders();
  await forgetBuyer();
  refresh();
}

/** Deletes the account for good. Firebase may ask for a recent sign-in first. */
export async function deleteAccount() {
  const u = auth().currentUser;
  if (!u) throw new AccountError('You aren’t signed in.');
  await deleteUser(u);
  await signOutProviders();
  await forgetBuyer();
  refresh();
}
