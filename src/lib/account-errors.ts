// What went wrong with a sign-in, in words a volunteer can act on. Kept apart from
// account.ts so it can be tested without Firebase or the native sign-in modules.
import type { AuthCredential } from 'firebase/auth';

/**
 * Thrown by a sign-in provider when the Google or Apple account is already a Cash Tin
 * account, so it can't be added to this phone's guest sign-in. `credential` signs in
 * to that account instead, or is null if the provider didn't give one back.
 */
export class CredentialInUse extends Error {
  constructor(public credential: AuthCredential | null) {
    super('credential-already-in-use');
    this.name = 'CredentialInUse';
  }
}

/** Something the volunteer has to sort out before trying again; `message` says what. */
export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

const codeOf = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : '';
};

/** True when the person closed the sign-in themselves, so nothing should be shown. */
export function isCancelled(e: unknown): boolean {
  const c = codeOf(e);
  return (
    c === 'auth/popup-closed-by-user' ||
    c === 'auth/cancelled-popup-request' ||
    c === 'auth/user-cancelled' ||
    c === 'ERR_REQUEST_CANCELED' || // Apple
    c === 'SIGN_IN_CANCELLED' || // Google, older versions
    c === 'IN_PROGRESS' // Google: a second tap while the first sign-in is open
  );
}

const MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'That doesn’t look like an email address.',
  'auth/missing-email': 'Type your email address.',
  'auth/missing-password': 'Type a password.',
  'auth/weak-password': 'Use a password of at least 8 characters.',
  'auth/password-does-not-meet-requirements': 'That password isn’t strong enough. Use at least 8 characters.',
  'auth/email-already-in-use': 'There’s already an account with that email. Choose “I have an account” to sign in.',
  'auth/invalid-credential': 'That email and password don’t match an account.',
  'auth/invalid-login-credentials': 'That email and password don’t match an account.',
  'auth/wrong-password': 'That email and password don’t match an account.',
  'auth/user-not-found': 'That email and password don’t match an account.',
  'auth/user-disabled': 'This account has been switched off.',
  'auth/account-exists-with-different-credential':
    'That email already has a Cash Tin account with a different sign-in. Use the way you signed in before.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'Couldn’t reach the server. Check you have signal, then try again.',
  'auth/requires-recent-login': 'For your security, sign out and back in, then try again.',
  'auth/operation-not-allowed': 'This way of signing in isn’t switched on for Cash Tin yet.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': 'Signing in isn’t allowed from this web address.',
  PLAY_SERVICES_NOT_AVAILABLE: 'Google sign-in needs Google Play services on this phone.',
};

/** A message to show for a failed sign-in, or null if the person cancelled it. */
export function accountErrorMessage(e: unknown): string | null {
  if (isCancelled(e)) return null;
  if (e instanceof AccountError) return e.message;
  if (e instanceof Error && e.message === 'timeout') return MESSAGES['auth/network-request-failed'];
  return MESSAGES[codeOf(e)] ?? 'Signing in didn’t work. Try again.';
}
