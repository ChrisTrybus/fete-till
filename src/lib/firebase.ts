import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { Platform } from 'react-native';

// Values come from the Firebase console (Project settings > Your apps > Web app).
// Put them in a .env file (see .env.example). They are not secrets: access is
// controlled by firestore.rules, not by hiding these.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

/** False until a .env with Firebase settings exists; the app then runs in local-only mode. */
export const cloudEnabled = Boolean(config.apiKey && config.projectId);

type Cloud = { db: Firestore; auth: FirebaseAuth.Auth };
let cloud: Cloud | null = null;

export function getCloud(): Cloud | null {
  if (!cloudEnabled) return null;
  if (cloud) return cloud;
  const app = getApps().length ? getApp() : initializeApp(config);

  let auth: FirebaseAuth.Auth;
  if (Platform.OS === 'web') {
    auth = FirebaseAuth.getAuth(app);
  } else {
    // getReactNativePersistence ships in the React Native build of firebase/auth but
    // is missing from the web type definitions, hence the cast. If it is unavailable
    // we fall back to in-memory auth: the app re-joins the event with its stored
    // code on launch, so a new anonymous user id is harmless.
    const rnPersistence = (FirebaseAuth as unknown as {
      getReactNativePersistence?: (s: typeof AsyncStorage) => FirebaseAuth.Persistence;
    }).getReactNativePersistence;
    try {
      auth = FirebaseAuth.initializeAuth(
        app,
        rnPersistence ? { persistence: rnPersistence(AsyncStorage) } : {},
      );
    } catch {
      auth = FirebaseAuth.getAuth(app); // already initialised (fast refresh)
    }
  }

  cloud = { db: getFirestore(app), auth };
  return cloud;
}

export async function ensureSignedIn(): Promise<string> {
  const c = getCloud();
  if (!c) throw new Error('Cloud sync is not configured');
  if (c.auth.currentUser) return c.auth.currentUser.uid;
  const cred = await FirebaseAuth.signInAnonymously(c.auth);
  return cred.user.uid;
}
