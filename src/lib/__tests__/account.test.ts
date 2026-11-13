/**
 * Accounts: a new sign-in is added to the phone's guest user, so its id (and its
 * place in a shared event) stays the same, and nothing that would change the id is
 * allowed while the phone is in a shared event.
 *
 * Firebase Auth and the Google/Apple sign-ins are replaced with fakes.
 */
import * as FirebaseAuth from 'firebase/auth';
import { accountErrorMessage, AccountError, CredentialInUse, isCancelled } from '../account-errors';
import * as Providers from '../account-providers';
import {
  createEmailAccount,
  deleteAccount,
  signInWithEmail,
  signInWithProvider,
  signOutAccount,
  SWITCH_BLOCKED,
  toAccount,
} from '../account';

type FakeUser = { uid: string; isAnonymous: boolean; providerData: { providerId: string }[]; email: string | null; displayName: string | null; emailVerified: boolean };
const fakeAuth: { currentUser: FakeUser | null } = { currentUser: null };

jest.mock('../firebase', () => ({
  cloudEnabled: true,
  getCloud: () => ({ auth: fakeAuth }),
  ensureSignedIn: jest.fn(async () => {
    fakeAuth.currentUser ??= { uid: 'guest-new', isAnonymous: true, providerData: [], email: null, displayName: null, emailVerified: false };
    return fakeAuth.currentUser.uid;
  }),
}));
jest.mock('../account-providers', () => ({
  availableProviders: jest.fn(async () => []),
  connectProvider: jest.fn(),
  signOutProviders: jest.fn(async () => {}),
}));
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
  linkWithCredential: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  signInWithEmailAndPassword: jest.fn(),
  signInWithCredential: jest.fn(),
  sendEmailVerification: jest.fn(async () => {}),
  sendPasswordResetEmail: jest.fn(),
  signOut: jest.fn(async () => {}),
  deleteUser: jest.fn(async () => {}),
  EmailAuthProvider: { credential: (email: string, password: string) => ({ providerId: 'password', email, password }) },
}));

const auth = jest.mocked(FirebaseAuth);
const providers = jest.mocked(Providers);

const guest = (): FakeUser => ({ uid: 'guest-1', isAnonymous: true, providerData: [], email: null, displayName: null, emailVerified: false });
const member = (): FakeUser => ({
  uid: 'acct-1',
  isAnonymous: false,
  providerData: [{ providerId: 'password' }],
  email: 'sam@example.com',
  displayName: null,
  emailVerified: false,
});

const OUT = { inSharedEvent: false };
const IN = { inSharedEvent: true };

beforeEach(() => {
  jest.clearAllMocks();
  fakeAuth.currentUser = guest();
});

describe('toAccount', () => {
  it('treats a guest user as signed out', () => {
    expect(toAccount(guest() as never)).toBeNull();
    expect(toAccount(null)).toBeNull();
  });

  it('lists how the account signs in, and trusts Google and Apple to have checked the email', () => {
    const u = { ...member(), providerData: [{ providerId: 'google.com' }, { providerId: 'apple.com' }, { providerId: 'phone' }] };
    expect(toAccount(u as never)).toEqual({ uid: 'acct-1', email: 'sam@example.com', name: null, emailVerified: true, methods: ['google', 'apple'] });
    expect(toAccount(member() as never)?.emailVerified).toBe(false);
  });
});

describe('creating an email account', () => {
  it('adds it to the guest user, keeping the id, and sends a confirmation link', async () => {
    const g = fakeAuth.currentUser;
    auth.linkWithCredential.mockResolvedValue({ user: g } as never);
    await createEmailAccount(' sam@example.com ', 'longenough', IN);
    expect(auth.linkWithCredential).toHaveBeenCalledWith(g, { providerId: 'password', email: 'sam@example.com', password: 'longenough' });
    expect(auth.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(auth.sendEmailVerification).toHaveBeenCalledWith(g);
  });

  it('makes a new user when the phone has never synced', async () => {
    fakeAuth.currentUser = null;
    auth.createUserWithEmailAndPassword.mockResolvedValue({ user: member() } as never);
    await createEmailAccount('sam@example.com', 'longenough', OUT);
    expect(auth.createUserWithEmailAndPassword).toHaveBeenCalledWith(fakeAuth, 'sam@example.com', 'longenough');
  });

  it('in a shared event with no saved sign-in, makes the guest first so the event keeps the id', async () => {
    fakeAuth.currentUser = null;
    auth.linkWithCredential.mockResolvedValue({ user: {} } as never);
    await createEmailAccount('sam@example.com', 'longenough', IN);
    expect(auth.linkWithCredential).toHaveBeenCalledWith(expect.objectContaining({ uid: 'guest-new' }), expect.anything());
  });

  it('refuses a short password before asking the server', async () => {
    await expect(createEmailAccount('sam@example.com', 'short', OUT)).rejects.toThrow('at least 8 characters');
    expect(auth.linkWithCredential).not.toHaveBeenCalled();
  });

  it('says to sign in instead when the email already has an account', async () => {
    auth.linkWithCredential.mockRejectedValue({ code: 'auth/credential-already-in-use' });
    await expect(createEmailAccount('sam@example.com', 'longenough', OUT)).rejects.toThrow('I have an account');
  });
});

describe('signing in to an existing account', () => {
  it('works outside a shared event', async () => {
    await signInWithEmail('sam@example.com', 'pw', OUT);
    expect(auth.signInWithEmailAndPassword).toHaveBeenCalledWith(fakeAuth, 'sam@example.com', 'pw');
  });

  it('is refused in a shared event, where it would change the phone’s id', async () => {
    await expect(signInWithEmail('sam@example.com', 'pw', IN)).rejects.toThrow(SWITCH_BLOCKED);
    expect(auth.signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('is refused when already signed in', async () => {
    fakeAuth.currentUser = member();
    await expect(signInWithEmail('sam@example.com', 'pw', OUT)).rejects.toThrow('already signed in');
  });
});

describe('Google and Apple', () => {
  it('links a new account to the guest user', async () => {
    const g = fakeAuth.currentUser;
    providers.connectProvider.mockResolvedValue(true);
    await expect(signInWithProvider('apple', IN)).resolves.toBe(true);
    expect(providers.connectProvider).toHaveBeenCalledWith(fakeAuth, 'apple', g);
  });

  it('resolves false when the person cancels', async () => {
    providers.connectProvider.mockResolvedValue(false);
    await expect(signInWithProvider('google', OUT)).resolves.toBe(false);
  });

  it('signs in to an account that already exists, outside a shared event', async () => {
    const cred = { providerId: 'google.com' };
    providers.connectProvider.mockRejectedValue(new CredentialInUse(cred as never));
    await expect(signInWithProvider('google', OUT)).resolves.toBe(true);
    expect(auth.signInWithCredential).toHaveBeenCalledWith(fakeAuth, cred);
  });

  it('asks the provider again when it gave no reusable credential', async () => {
    providers.connectProvider.mockRejectedValueOnce(new CredentialInUse(null)).mockResolvedValueOnce(true);
    await expect(signInWithProvider('apple', OUT)).resolves.toBe(true);
    expect(auth.signOut).toHaveBeenCalled();
    expect(providers.connectProvider).toHaveBeenLastCalledWith(fakeAuth, 'apple', null);
  });

  it('won’t swap to an existing account in a shared event', async () => {
    providers.connectProvider.mockRejectedValue(new CredentialInUse({} as never));
    await expect(signInWithProvider('google', IN)).rejects.toThrow('That Google account already has a Cash Tin account');
    expect(auth.signInWithCredential).not.toHaveBeenCalled();
  });
});

describe('signing out and deleting', () => {
  beforeEach(() => {
    fakeAuth.currentUser = member();
  });

  it('signs out of Firebase and the providers', async () => {
    await signOutAccount(OUT);
    expect(auth.signOut).toHaveBeenCalled();
    expect(providers.signOutProviders).toHaveBeenCalled();
  });

  it('deletes the signed-in account', async () => {
    const u = fakeAuth.currentUser;
    await deleteAccount(OUT);
    expect(auth.deleteUser).toHaveBeenCalledWith(u);
  });

  it('does neither in a shared event', async () => {
    await expect(signOutAccount(IN)).rejects.toBeInstanceOf(AccountError);
    await expect(deleteAccount(IN)).rejects.toBeInstanceOf(AccountError);
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(auth.deleteUser).not.toHaveBeenCalled();
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
});
