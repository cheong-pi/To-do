export const appDataStorageKeys = [
  "dont-forget.tasks.v1",
  "dont-forget.schedules.v1",
  "dont-forget-app-settings",
  "dont-forget-plan-blocks",
  "dont-forget-memos",
  "dont-forget-learned-words",
  "dont-forget-timer-settings",
  "dont-forget-daily-focus",
  "dont-forget-daily-notes"
] as const;

export type AppDataBackup = {
  version: 1;
  updatedAt: string;
  data: Record<string, string | null>;
};

export function createAppDataBackup(): AppDataBackup {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    data: Object.fromEntries(appDataStorageKeys.map((key) => [key, window.localStorage.getItem(key)]))
  };
}

export function restoreAppDataBackup(backup: AppDataBackup) {
  appDataStorageKeys.forEach((key) => {
    const value = backup.data[key];
    if (value === null || value === undefined) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  });
}

export function isAppDataBackup(value: unknown): value is AppDataBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<AppDataBackup>;
  return (
    backup.version === 1 &&
    typeof backup.updatedAt === "string" &&
    !Number.isNaN(new Date(backup.updatedAt).getTime()) &&
    Boolean(backup.data) &&
    typeof backup.data === "object"
  );
}
