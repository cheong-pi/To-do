const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const DRIVE_FILE_NAME = "dont-forget-data.json";
const LAST_SYNC_KEY = "dont-forget-drive-last-sync";
const SESSION_TOKEN_KEY = "dont-forget-drive-token";
const RECOVERY_BACKUP_KEY = "dont-forget-drive-recovery";

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

type TokenResponse = {
  access_token?: string;
  error?: string;
};

type TokenClient = {
  callback: (response: TokenResponse) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
};

export type DriveBackup = {
  version: 1;
  updatedAt: string;
  data: Record<string, string | null>;
};

type DriveRecoveryBackup = {
  createdAt: string;
  backup: DriveBackup;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (options: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
          }) => TokenClient;
          revoke: (token: string, callback: () => void) => void;
        };
      };
    };
  }
}

let accessToken: string | null = sessionStorage.getItem(SESSION_TOKEN_KEY);
let driveFileId: string | null = null;
let pendingRemoteBackup: DriveBackup | null = null;

export function isGoogleDriveConfigured() {
  return Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
}

export function isGoogleDriveConnected() {
  return Boolean(accessToken);
}

export async function connectGoogleDrive() {
  if (!isGoogleDriveConfigured()) {
    throw new Error("GOOGLE_CLIENT_ID_MISSING");
  }

  await waitForGoogleIdentity();

  const token = await new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "GOOGLE_DRIVE_LOGIN_FAILED"));
          return;
        }
        resolve(response.access_token);
      }
    });

    client.requestAccessToken({ prompt: "consent" });
  });

  accessToken = token;
  sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  const remoteBackup = await downloadDriveBackup();

  if (remoteBackup) {
    const localBackup = createDriveBackup();
    if (JSON.stringify(remoteBackup.data) === JSON.stringify(localBackup.data)) {
      localStorage.setItem(LAST_SYNC_KEY, remoteBackup.updatedAt);
      return { status: "synced" as const, updatedAt: remoteBackup.updatedAt };
    }

    saveDriveRecoveryBackup();
    pendingRemoteBackup = remoteBackup;
    return { status: "conflict" as const, updatedAt: remoteBackup.updatedAt };
  }

  const backup = createDriveBackup();
  await uploadDriveBackup(backup);
  localStorage.setItem(LAST_SYNC_KEY, backup.updatedAt);
  return { status: "synced" as const, updatedAt: backup.updatedAt };
}

export async function resolveDriveConflict(choice: "remote" | "local") {
  if (!accessToken || !pendingRemoteBackup) throw new Error("GOOGLE_DRIVE_CONFLICT_NOT_FOUND");

  if (choice === "remote") {
    const updatedAt = pendingRemoteBackup.updatedAt;
    applyDriveBackup(pendingRemoteBackup);
    localStorage.setItem(LAST_SYNC_KEY, updatedAt);
    pendingRemoteBackup = null;
    return updatedAt;
  }

  const backup = createDriveBackup();
  await uploadDriveBackup(backup);
  localStorage.setItem(LAST_SYNC_KEY, backup.updatedAt);
  pendingRemoteBackup = null;
  return backup.updatedAt;
}

export async function disconnectGoogleDrive() {
  const token = accessToken;
  accessToken = null;
  driveFileId = null;
  pendingRemoteBackup = null;
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  if (!token || !window.google) return;

  await new Promise<void>((resolve) => {
    window.google!.accounts.oauth2.revoke(token, resolve);
  });
}

export async function syncToGoogleDrive() {
  if (!accessToken) throw new Error("GOOGLE_DRIVE_NOT_CONNECTED");
  const backup = createDriveBackup();
  await uploadDriveBackup(backup);
  localStorage.setItem(LAST_SYNC_KEY, backup.updatedAt);
  return backup.updatedAt;
}

export function getLastDriveSync() {
  return localStorage.getItem(LAST_SYNC_KEY);
}

export function getDriveRecoveryCreatedAt() {
  return readDriveRecoveryBackup()?.createdAt ?? null;
}

export function restoreDriveRecoveryBackup() {
  const recovery = readDriveRecoveryBackup();
  if (!recovery) return false;
  applyDriveBackup(recovery.backup);
  localStorage.removeItem(RECOVERY_BACKUP_KEY);
  return true;
}

export function clearDriveRecoveryBackup() {
  localStorage.removeItem(RECOVERY_BACKUP_KEY);
}

export function createDriveBackup(): DriveBackup {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    data: Object.fromEntries(appDataStorageKeys.map((key) => [key, localStorage.getItem(key)]))
  };
}

function saveDriveRecoveryBackup() {
  const recovery: DriveRecoveryBackup = {
    createdAt: new Date().toISOString(),
    backup: createDriveBackup()
  };
  localStorage.setItem(RECOVERY_BACKUP_KEY, JSON.stringify(recovery));
}

function readDriveRecoveryBackup(): DriveRecoveryBackup | null {
  const rawValue = localStorage.getItem(RECOVERY_BACKUP_KEY);
  if (!rawValue) return null;

  try {
    const recovery = JSON.parse(rawValue) as Partial<DriveRecoveryBackup>;
    if (
      typeof recovery.createdAt !== "string" ||
      !recovery.backup ||
      recovery.backup.version !== 1 ||
      typeof recovery.backup.updatedAt !== "string" ||
      !recovery.backup.data ||
      typeof recovery.backup.data !== "object"
    ) {
      localStorage.removeItem(RECOVERY_BACKUP_KEY);
      return null;
    }
    return recovery as DriveRecoveryBackup;
  } catch {
    localStorage.removeItem(RECOVERY_BACKUP_KEY);
    return null;
  }
}

function applyDriveBackup(backup: DriveBackup) {
  appDataStorageKeys.forEach((key) => {
    const value = backup.data[key];
    if (typeof value === "string") {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  });
}

async function downloadDriveBackup() {
  const file = await findDriveFile();
  if (!file) return null;
  driveFileId = file.id;

  const response = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`
  );
  const backup = (await response.json()) as Partial<DriveBackup>;
  if (backup.version !== 1 || !backup.data || typeof backup.updatedAt !== "string") {
    throw new Error("GOOGLE_DRIVE_BACKUP_INVALID");
  }
  return backup as DriveBackup;
}

async function uploadDriveBackup(backup: DriveBackup) {
  if (!driveFileId) {
    driveFileId = (await findDriveFile())?.id ?? null;
  }

  const metadata = driveFileId
    ? { name: DRIVE_FILE_NAME }
    : { name: DRIVE_FILE_NAME, parents: ["appDataFolder"] };
  const boundary = `dont-forget-${Date.now()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(backup),
    `--${boundary}--`
  ].join("\r\n");

  const endpoint = driveFileId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(driveFileId)}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  const response = await driveFetch(endpoint, {
    method: driveFileId ? "PATCH" : "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body
  });
  const file = (await response.json()) as DriveFile;
  driveFileId = file.id;
}

async function findDriveFile() {
  const query = encodeURIComponent(`name = '${DRIVE_FILE_NAME}' and trashed = false`);
  const response = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)&pageSize=1`
  );
  const result = (await response.json()) as { files?: DriveFile[] };
  return result.files?.[0] ?? null;
}

async function driveFetch(url: string, init: RequestInit = {}) {
  if (!accessToken) throw new Error("GOOGLE_DRIVE_NOT_CONNECTED");

  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      accessToken = null;
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }
    throw new Error(`GOOGLE_DRIVE_${response.status}`);
  }
  return response;
}

async function waitForGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("GOOGLE_IDENTITY_LOAD_FAILED")), 10_000);
    const timer = window.setInterval(() => {
      if (!window.google?.accounts?.oauth2) return;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
      resolve();
    }, 50);
  });
}
