// Google sign-in in a browser, through Firebase's own pop-up. Apple isn't offered on
// the web: it would need an Apple Services ID, and Apple only requires it on iOS.
import { GoogleAuthProvider, signInWithPopup, type Auth } from 'firebase/auth';

export type Provider = 'google' | 'apple';

export async function availableProviders(): Promise<Provider[]> {
  return ['google'];
}

/** As in account-providers.ts. */
export async function connectProvider(auth: Auth, provider: Provider): Promise<boolean> {
  if (provider !== 'google') throw new Error('Only Google sign-in is available in a browser.');
  const google = new GoogleAuthProvider();
  google.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(auth, google);
  return true;
}

export async function signOutProviders() {}
