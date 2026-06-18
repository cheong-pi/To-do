import { appDataStorageKeys, type AppDataBackup } from "./appDataStorage";

const RECOVERY_KEY = "dont-forget-local-recovery";

type LocalRecovery = {
  createdAt: string;
  reason: "restore" | "delete";
  backup: AppDataBackup;
};

export function saveLocalRecovery(reason: LocalRecovery["reason"]) {
  const createdAt = new Date().toISOString();
  const recovery: LocalRecovery = {
    createdAt,
    reason,
    backup: {
      version: 1,
      updatedAt: createdAt,
      data: Object.fromEntries(appDataStorageKeys.map((key) => [key, localStorage.getItem(key)]))
    }
  };

  localStorage.setItem(RECOVERY_KEY, JSON.stringify(recovery));
  return createdAt;
}

export function getLocalRecovery() {
  const rawValue = localStorage.getItem(RECOVERY_KEY);
  if (!rawValue) return null;

  try {
    const recovery = JSON.parse(rawValue) as Partial<LocalRecovery>;
    if (
      typeof recovery.createdAt !== "string" ||
      (recovery.reason !== "restore" && recovery.reason !== "delete") ||
      !recovery.backup ||
      recovery.backup.version !== 1 ||
      !recovery.backup.data ||
      typeof recovery.backup.data !== "object"
    ) {
      localStorage.removeItem(RECOVERY_KEY);
      return null;
    }
    return recovery as LocalRecovery;
  } catch {
    localStorage.removeItem(RECOVERY_KEY);
    return null;
  }
}

export function restoreLocalRecovery() {
  const recovery = getLocalRecovery();
  if (!recovery) return false;

  appDataStorageKeys.forEach((key) => {
    const value = recovery.backup.data[key];
    if (typeof value === "string") {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  });
  localStorage.removeItem(RECOVERY_KEY);
  return true;
}
