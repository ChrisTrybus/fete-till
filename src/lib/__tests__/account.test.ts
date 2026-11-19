/**
 * Accounts sign in on their own Firebase Auth, never the events one, so a phone's
 * place in an event doesn't depend on which account it uses.
 *
 * Firebase Auth and the Google/Apple sign-ins are replaced with fakes.
 */
import * as FirebaseAuth from 'firebase/auth';
import { accountErrorMessage, AccountError, isCancelled, providerErrorMessage } from '../account-errors';
import * as Providers from '../account-providers';
import {
  createEmailAccount,
  deleteAccount,
  signInWithEmail,
  signInWithProvider,
  signOutAccount,
  toAccount,
} from '../account';

type FakeUser = { uid: string; isAnonymous: boolean; providerData: { providerId: string }[]; email: string | null; displayName: string | null; emailVerified: boolean };
const accountAuth: { currentUser: FakeUser | null } = { currentUser: null };
const eventsAuth = { currentUser: { uid: 'guest-1', isAnonymous: true } };

jest.mock('../firebase', () => ({
  cloudEnabled: true,
  getAccountAuth: () => accountAuth,
  getCloud: () => ({ auth: eventsAuth }),
}));
jest.mock('../account-providers', () => ({
  availableProviders: jest.fn(async () => []),
  connectProvider: jest.fn(),
  signOutProviders: jest.fn(async () => {}),
}));
jest.mock('../store-purchases', () => ({ forgetBuyer: jest.fn(async () => {}) }));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  sendEmailVerification: jest.fn(async () => {}),
  sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn(async () => {}),
  deleteUser: jest.fn(async () => {}),
}));

const auth = jest.mocked(FirebaseAuth);
const providers = jest.mocked(Providers);

const member = (): FakeUser => ({
  uid: 'acct-1',
  isAnonymous: false,
  providerData: [{ providerId: 'password' }],
  email: 'sam@example.com',
  displayName: null,
  emailVerified: false,
});

beforeEach(() => {
  jest.clearAllMocks();
  accountAuth.currentUser = null;
});

describe('toAccount', () => {
  it('is null when nobody is signed in', () => {
    expect(toAccount(null)).toBeNull();
    expect(toAccount({ ...member(), isAnonymous: true } as never)).toBeNull();
  });

  it('lists how the account signs in, and trusts Google and Apple to have checked the email', () => {
    const u = { ...member(), providerData: [{ providerId: 'google.com' }, { providerId: 'apple.com' }, { providerId: 'phone' }] };
    expect(toAccount(u as never)).toEqual({ uid: 'acct-1', email: 'sam@example.com', name: null, emailVerified: true, methods: ['google', 'apple'] });
    expect(toAccount(member() as never)?.emailVerified).toBe(false);
  });
});

describe('accounts are kept apart from events', () => {
  it('signs in on the account Auth, leaving the phone’s event user alone', async () => {
    providers.connectProvider.mockResolvedValue(true);
    await signInWithProvider('google');
    expect(providers.connectProvider).toHaveBeenCalledWith(accountAuth, 'google');
    await signInWithEmail('sam@example.com', 'pw');
    expect(auth.signInWithEmailAndPassword).toHaveBeenCalledWith(accountAuth, 'sam@example.com', 'pw');
    expect(eventsAuth.currentUser.uid).toBe('guest-1');
  });

  it('signs out of the account Auth only', async () => {
    accountAuth.currentUser = member();
    await signOutAccount();
    expect(auth.signOut).toHaveBeenCalledWith(accountAuth);
    expect(providers.signOutProviders).toHaveBeenCalled();
  });
});

describe('email accounts', () => {
  it('makes the account and sends a confirmation link', async () => {
    const u = member();
    auth.createUserWithEmailAndPassword.mockResolvedValue({ user: u } as never);
    await createEmailAccount(' sam@example.com ', 'longenough');
    expect(auth.createUserWithEmailAndPassword).toHaveBeenCalledWith(accountAuth, 'sam@example.com', 'longenough');
    expect(auth.sendEmailVerification).toHaveBeenCalledWith(u);
  });

  it('refuses a short password before asking the server', async () => {
    await expect(createEmailAccount('sam@example.com', 'short')).rejects.toThrow('at least 8 characters');
    expect(auth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('won’t sign in again over an account that is already signed in', async () => {
    accountAuth.currentUser = member();
    await expect(signInWithEmail('sam@example.com', 'pw')).rejects.toThrow('already signed in');
    await expect(signInWithProvider('apple')).rejects.toThrow('already signed in');
  });
});

describe('Google and Apple', () => {
  it('resolves false when the person cancels', async () => {
    providers.connectProvider.mockResolvedValue(false);
    await expect(signInWithProvider('google')).resolves.toBe(false);
  });
});

describe('deleting', () => {
  it('deletes the signed-in account', async () => {
    const u = member();
    accountAuth.currentUser = u;
    await deleteAccount();
    expect(auth.deleteUser).toHaveBeenCalledWith(u);
  });

  it('says so when nobody is signed in', async () => {
    await expect(deleteAccount()).rejects.toBeInstanceOf(AccountError);
  });
});

describe('error messages', () => {
  it('shows nothing when the person cancelled', () => {
    expect(isCancelled({ code: 'ERR_REQUEST_CANCELED' })).toBe(true);
    expect(accountErrorMessage({ code: 'auth/popup-closed-by-user' })).toBeNull();
  });

  it('turns Firebase codes into plain words, with a fallback', () => {
    expect(accountErrorMessage({ code: 'auth/invalid-credential' })).toBe('That email and password don’t match an account.');
    expect(accountErrorMessage({ code: 'auth/network-request-failed' })).toMatch('signal');
    expect(accountErrorMessage(new AccountError('Do this.'))).toBe('Do this.');
    expect(accountErrorMessage(new Error('weird'))).toBe('Signing in didn’t work. Try again.');
  });

  it('never blames an email and password when Google or Apple sign-in is refused', () => {
    const refused = Object.assign(
      new Error('Firebase: The audience in ID Token [x] does not match the expected audience. (auth/invalid-credential).'),
      { code: 'auth/invalid-credential' },
    );
    const message = providerErrorMessage(refused, 'apple');
    expect(message).toMatch('with Apple');
    expect(message).toMatch('does not match the expected audience');
    expect(message).not.toMatch('email and password don’t match');
    expect(providerErrorMessage(Object.assign(new Error('Firebase: Error (auth/invalid-credential).'), { code: 'auth/invalid-credential' }), 'google')).toBe(
      'Cash Tin couldn’t sign you in with Google. Try again later, or use email and password.',
    );
    expect(providerErrorMessage({ code: 'ERR_REQUEST_CANCELED' }, 'apple')).toBeNull();
  });

  it('shows the Cash Tin server’s own words, unless it fell over', () => {
    const server = (code: string, message = 'You need an event pack.') => Object.assign(new Error(message), { code });
    expect(accountErrorMessage(server('functions/failed-precondition'))).toBe('You need an event pack.');
    expect(accountErrorMessage(server('functions/internal', 'INTERNAL'))).toMatch('server');
    expect(accountErrorMessage(server('functions/unavailable'))).toMatch('signal');
  });

  it('says nothing when a purchase is cancelled, and keeps store errors plain', () => {
    expect(accountErrorMessage({ userCancelled: true, code: '1' })).toBeNull();
    expect(accountErrorMessage({ userCancelled: false, code: '2', message: 'STORE_PROBLEM' })).toBe('The purchase didn’t go through. Try again.');
  });
});
