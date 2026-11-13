// Google sign-in in a browser, through Firebase's own pop-up. Apple isn't offered on
// the web: it would need an Apple Services ID, and Apple only requires it on iOS.
import {
  GoogleAuthProvider,
  linkWithPopup,
  signInWithPopup,
  type Auth,
  type User,
} from 'firebase/auth';
import { CredentialInUse } from './account-errors';

export type Provider = 'google' | 'apple';

export async function availableProviders(): Promise<Provider[]> {
  return ['google'];
}

/** As in account-providers.ts: links to `guest` if given, otherwise signs in. */
export async function connectProvider(auth: Auth, provider: Provider, guest: User | null): Promise<boolean> {
  if (provider !== 'google') throw new Error('Only Google sign-in is available in a browser.');
  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: 'select_account' });
  try {
    if (guest) await linkWithPopup(guest, google);
    else await signInWithPopup(auth, google);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/credential-already-in-use') {
      throw new CredentialInUse(GoogleAuthProvider.credentialFromError(e as never));
    }
    throw e;
  }
}

export async function signOutProviders() {}
