// Cash Tin accounts: a real sign-in (email and password, Google, or Apple) that will hold
// event credits and saved price lists, which have to survive a reinstall.
//
// Every phone that syncs already has an anonymous ("guest") Firebase user, and an event's
// membership and organiser role are held against that user's id. Creating an account
// links the new sign-in to the guest user, so the id, and with it the phone's place in
// any event, stays the same. Signing in to an account that already exists swaps the id,
// which would take the phone out of a shared event it is in, so that is only allowed
// when the phone isn't in one.
import {
  createUserWithEmailAndPassword,
  deleteUser,
  EmailAuthProvider,
  linkWithCredential,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { useSyncExternalStore } from 'react';
import { AccountError, CredentialInUse } from './account-errors';
import { availableProviders, connectProvider, signOutProviders, type Provider } from './account-providers';
import { cloudEnabled, ensureSignedIn, getCloud } from './firebase';

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

/** Whether the phone is in an event shared with other tills, where its user id must not change. */
export type AccountContext = { inSharedEvent: boolean };

const METHOD_OF: Record<string, SignInMethod> = { password: 'password', 'google.com': 'google', 'apple.com': 'apple' };

export const MIN_PASSWORD = 8;

/** The signed-in account, or null for a guest (anonymous) user or nobody. */
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

export const SWITCH_BLOCKED =
  'This phone is in a shared event. Signing in to a different account now would take it out of the event, so sign in after you leave it.';

const PROVIDER_NAME: Record<Provider, string> = { google: 'Google', apple: 'Apple' };

// ---- Watching the signed-in account ------------------------------------------------

type Snapshot = { ready: boolean; account: Account | null };
let snapshot: Snapshot = { ready: !cloudEnabled, account: null };
const listeners = new Set<() => void>();
let watching = false;

/** Re-reads the current user. Linking an account doesn't fire Firebase's listener, so every change here calls it. */
function refresh() {
  const next: Snapshot = { ready: true, account: toAccount(getCloud()?.auth.currentUser ?? null) };
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const cloud = getCloud();
  if (!watching && cloud) {
    watching = true;
    onAuthStateChanged(cloud.auth, refresh);
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
  const cloud = getCloud();
  if (!cloud) throw new AccountError('Accounts aren’t set up in this version of the app.');
  return cloud.auth;
}

/**
 * The guest user to add a new sign-in to, or null if there is none. In a shared event the
 * guest is made first if missing, so the event keeps the id the account ends up with.
 */
async function guestUser(a: Auth, ctx: AccountContext): Promise<User | null> {
  if (!a.currentUser && ctx.inSharedEvent) await ensureSignedIn();
  const u = a.currentUser;
  if (u && !u.isAnonymous) throw new AccountError('You’re already signed in. Sign out first to use another account.');
  return u;
}

/** Signs in with Google or Apple, making the account if it is new. Resolves false if the person cancelled. */
export async function signInWithProvider(provider: Provider, ctx: AccountContext): Promise<boolean> {
  const a = auth();
  const guest = await guestUser(a, ctx);
  try {
    const ok = await connectProvider(a, provider, guest);
    refresh();
    return ok;
  } catch (e) {
    if (!(e instanceof CredentialInUse)) throw e;
    // The account already exists, so signing in to it means leaving the guest user behind.
    if (ctx.inSharedEvent) {
      throw new AccountError(`That ${PROVIDER_NAME[provider]} account already has a Cash Tin account. ${SWITCH_BLOCKED}`);
    }
    if (e.credential) await signInWithCredential(a, e.credential);
    else {
      // The provider gave nothing reusable back: drop the guest and ask once more.
      await signOut(a);
      if (!(await connectProvider(a, provider, null))) return false;
    }
    refresh();
    return true;
  }
}

const cleanEmail = (email: string) => email.trim();

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD) throw new AccountError(`Use a password of at least ${MIN_PASSWORD} characters.`);
}

/** Makes a new account with an email and password, and sends a link to confirm the address. */
export async function createEmailAccount(email: string, password: string, ctx: AccountContext) {
  checkPassword(password);
  const a = auth();
  const guest = await guestUser(a, ctx);
  try {
    const result = guest
      ? await linkWithCredential(guest, EmailAuthProvider.credential(cleanEmail(email), password))
      : await createUserWithEmailAndPassword(a, cleanEmail(email), password);
    await sendEmailVerification(result.user).catch(() => {});
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/credential-already-in-use') {
      throw new AccountError('There’s already an account with that email. Choose “I have an account” to sign in.');
    }
    throw e;
  } finally {
    refresh();
  }
}

/** Signs in to an existing email account. Not allowed while the phone is in a shared event. */
export async function signInWithEmail(email: string, password: string, ctx: AccountContext) {
  if (ctx.inSharedEvent) throw new AccountError(SWITCH_BLOCKED);
  const a = auth();
  await guestUser(a, ctx);
  await signInWithEmailAndPassword(a, cleanEmail(email), password);
  refresh();
}

export async function sendPasswordReset(email: string) {
  if (!cleanEmail(email)) throw new AccountError('Type your email address first.');
  await sendPasswordResetEmail(auth(), cleanEmail(email));
}

export async function resendVerification() {
  const u = auth().currentUser;
  if (u && !u.isAnonymous) await sendEmailVerification(u);
}

/** Fetches the account again, e.g. to see that its email has been confirmed. */
export async function reloadAccount() {
  await auth().currentUser?.reload();
  refresh();
}

/** Signs out. The phone becomes a guest again the next time it syncs. */
export async function signOutAccount(ctx: AccountContext) {
  if (ctx.inSharedEvent) throw new AccountError('Leave the shared event before signing out, or this phone would drop out of it.');
  await signOut(auth());
  await signOutProviders();
  refresh();
}

/** Deletes the account for good. Firebase may ask for a recent sign-in first. */
export async function deleteAccount(ctx: AccountContext) {
  if (ctx.inSharedEvent) throw new AccountError('Leave the shared event before deleting your account.');
  const u = auth().currentUser;
  if (!u || u.isAnonymous) throw new AccountError('You aren’t signed in.');
  await deleteUser(u);
  await signOutProviders();
  refresh();
}
