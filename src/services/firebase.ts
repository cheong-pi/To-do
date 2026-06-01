import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type Auth, type User } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

type FirebaseServices = {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  googleProvider: GoogleAuthProvider;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const hasFirebaseConfig = Object.values(firebaseConfig).every(Boolean);

export const firebaseServices: FirebaseServices | null = hasFirebaseConfig
  ? createFirebaseServices()
  : null;

export function isFirebaseConfigured() {
  return firebaseServices !== null;
}

export async function signInWithGoogle() {
  if (!firebaseServices) {
    throw new Error("Firebase config is missing");
  }

  return signInWithPopup(firebaseServices.auth, firebaseServices.googleProvider);
}

export async function signOutUser() {
  if (!firebaseServices) return;
  await signOut(firebaseServices.auth);
}

export function subscribeAuthState(onChange: (user: User | null) => void) {
  if (!firebaseServices) return () => undefined;
  return onAuthStateChanged(firebaseServices.auth, onChange);
}

function createFirebaseServices(): FirebaseServices {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const googleProvider = new GoogleAuthProvider();

  return {
    app,
    auth,
    db,
    googleProvider
  };
}
