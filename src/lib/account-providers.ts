// Google and Apple sign-in on a phone. Each provider's own native sign-in gives an id
// token, which Firebase turns into a credential; account.ts decides what to do with it.
// The web version is account-providers.web.ts.
//
// Google needs native code, so it isn't in Expo Go: it is only offered in a build of
// this app. Apple is iOS only, which is also the only place Apple requires it.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  GoogleAuthProvider,
  linkWithCredential,
  OAuthProvider,
  signInWithCredential,
  updateProfile,
  type Auth,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { CredentialInUse } from './account-errors';

export type Provider = 'google' | 'apple';

// Must be read as written here: Expo inlines EXPO_PUBLIC_ variables at build time.
const GOOGLE_WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
const GOOGLE_IOS_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let google: GoogleModule | null = null;
/** Loaded on first use: importing it in Expo Go, which lacks its native code, would crash the app. */
function googleSignin(): GoogleModule {
  if (!google) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded lazily on purpose, see above
    google = require('@react-native-google-signin/google-signin') as GoogleModule;
    google.GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
    });
  }
  return google;
}

const googleConfigured =
  !inExpoGo &&
  GOOGLE_WEB_CLIENT_ID.length > 0 &&
  (Platform.OS === 'android' || (Platform.OS === 'ios' && GOOGLE_IOS_CLIENT_ID.length > 0));

/** The providers this phone can offer. */
export async function availableProviders(): Promise<Provider[]> {
  const list: Provider[] = [];
  if (Platform.OS === 'ios') {
    try {
      if (await AppleAuthentication.isAvailableAsync()) list.push('apple');
    } catch {
      // Not offered.
    }
  }
  if (googleConfigured) list.push('google');
  return list;
}

/** A credential from the provider's own sign-in, or null if the person cancelled. */
async function credentialFor(provider: Provider): Promise<{ credential: AuthCredential; name: string | null } | null> {
  if (provider === 'google') {
    const { GoogleSignin, isSuccessResponse } = googleSignin();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) return null;
    if (!res.data.idToken) throw new Error('Google didn’t return an id token. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.');
    return { credential: GoogleAuthProvider.credential(res.data.idToken), name: res.data.user.name };
  }

  // Apple: Firebase checks the token was made for this sign-in by matching the nonce.
  // Apple is given its SHA-256 hash and Firebase the original.
  const rawNonce = Crypto.randomUUID() + Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const apple = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
    nonce: hashedNonce,
  });
  if (!apple.identityToken) throw new Error('Apple didn’t return an identity token.');
  // Apple only gives the name the first time someone signs in to this app.
  const name = apple.fullName
    ? [apple.fullName.givenName, apple.fullName.familyName].filter(Boolean).join(' ') || null
    : null;
  return { credential: new OAuthProvider('apple.com').credential({ idToken: apple.identityToken, rawNonce }), name };
}

/**
 * Signs in with Google or Apple. With `guest`, the account is added to that guest
 * sign-in, so this phone keeps its user id. Resolves false if the person cancelled.
 * Throws CredentialInUse if the account already belongs to another Cash Tin user.
 */
export async function connectProvider(auth: Auth, provider: Provider, guest: User | null): Promise<boolean> {
  const got = await credentialFor(provider);
  if (!got) return false;
  try {
    const result = guest ? await linkWithCredential(guest, got.credential) : await signInWithCredential(auth, got.credential);
    if (got.name && !result.user.displayName) await updateProfile(result.user, { displayName: got.name }).catch(() => {});
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === 'auth/credential-already-in-use') {
      const fromError =
        provider === 'google'
          ? GoogleAuthProvider.credentialFromError(e as never)
          : OAuthProvider.credentialFromError(e as never);
      // Apple's token can't be used twice, so prefer the one Firebase hands back.
      throw new CredentialInUse(fromError ?? (provider === 'google' ? got.credential : null));
    }
    throw e;
  }
}

/** Forgets the Google account chosen, so the next sign-in asks which one to use. */
export async function signOutProviders() {
  if (googleConfigured && google) await google.GoogleSignin.signOut().catch(() => null);
}
