import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { firebaseServices } from "./firebase";

export type UserAppDataKey = "settings" | "wordProgress" | "memos" | "planBlocks" | "schedules";

type StoredUserAppData<T> = {
  value: T;
  updatedAt?: unknown;
};

export function subscribeUserAppData<T>(
  userId: string,
  key: UserAppDataKey,
  onValue: (value: T | null) => void,
  onError: (error: Error) => void
) {
  if (!firebaseServices) return () => undefined;

  return onSnapshot(
    getUserAppDataDoc(userId, key),
    (snapshot) => {
      if (!snapshot.exists()) {
        onValue(null);
        return;
      }

      const data = snapshot.data() as Partial<StoredUserAppData<T>>;
      onValue(data.value ?? null);
    },
    onError
  );
}

export async function saveUserAppData<T>(userId: string, key: UserAppDataKey, value: T) {
  if (!firebaseServices) return;

  await setDoc(
    getUserAppDataDoc(userId, key),
    {
      value,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function getUserAppDataDoc(userId: string, key: UserAppDataKey) {
  if (!firebaseServices) {
    throw new Error("Firebase config is missing");
  }

  return doc(firebaseServices.db, "users", userId, "appData", key);
}
