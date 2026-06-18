import { createAppDataBackup, isAppDataBackup, restoreAppDataBackup, type AppDataBackup } from "./appDataStorage";

const driveFileName = "dont-forget-data.json";
const driveScope = "https://www.googleapis.com/auth/drive.appdata";
const gisScriptUrl = "https://accounts.google.com/gsi/client";

type TokenResponse = {
  access_token?: string;
  error?: string;
};

type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
};

type DriveListResponse = {
  files?: DriveFile[];
};

type GoogleTokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleAccounts = {
  oauth2: {
    initTokenClient: (options: {
      client_id: string;
      scope: string;
      callback: (response: TokenResponse) => void;
    }) => GoogleTokenClient;
  };
};

declare global {
  interface Window {
    google?: {
      accounts?: GoogleAccounts;
    };
  }
}

export type DriveSyncState =
  | "not_configured"
  | "signed_out"
  | "signing_in"
  | "idle"
  | "syncing"
  | "error";

export type DriveSyncStatus = {
  state: DriveSyncState;
  lastSyncedAt: string | null;
  message: string;
};

export type DriveSyncResult = {
  backup: AppDataBackup;
  remoteModifiedAt: string | null;
};

let accessToken: string | null = null;

export function getGoogleDriveClientId() {
  const saved = window.localStorage.getItem("dont-forget-google-client-id");
  return saved || import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
}

export function saveGoogleDriveClientId(clientId: string) {
  const trimmed = clientId.trim();
  if (trimmed) {
    window.localStorage.setItem("dont-forget-google-client-id", trimmed);
  } else {
    window.localStorage.removeItem("dont-forget-google-client-id");
  }
}

export function hasGoogleDriveToken() {
  return Boolean(accessToken);
}

export function disconnectGoogleDrive() {
  accessToken = null;
}

export async function connectGoogleDrive(clientId: string) {
  if (!clientId.trim()) throw new Error("Google OAuth Client ID is required.");
  await loadGoogleIdentityScript();

  const google = window.google?.accounts;
  if (!google) throw new Error("Google sign-in could not be loaded.");

  accessToken = await new Promise<string>((resolve, reject) => {
    const tokenClient = google.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: driveScope,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error || "Google sign-in was cancelled."));
          return;
        }
        resolve(response.access_token);
      }
    });
    tokenClient.requestAccessToken({ prompt: "consent" });
  });
}

export async function downloadGoogleDriveBackup(): Promise<DriveSyncResult | null> {
  const file = await findDriveFile();
  if (!file) return null;

  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
  const payload: unknown = await response.json();
  if (!isAppDataBackup(payload)) throw new Error("Drive data is not a valid Don't Forget backup.");

  return {
    backup: payload,
    remoteModifiedAt: file.modifiedTime ?? null
  };
}

export async function uploadGoogleDriveBackup() {
  const backup = createAppDataBackup();
  const file = await findDriveFile();
  const body = JSON.stringify(backup, null, 2);

  if (file) {
    await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${file.id}?uploadType=media`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body
    });
    return backup;
  }

  const boundary = `dont_forget_${Date.now()}`;
  await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify({ name: driveFileName, parents: ["appDataFolder"] }),
      `--${boundary}`,
      "Content-Type: application/json",
      "",
      body,
      `--${boundary}--`
    ].join("\r\n")
  });
  return backup;
}

export function restoreGoogleDriveBackup(backup: AppDataBackup) {
  restoreAppDataBackup(backup);
}

async function findDriveFile() {
  const params = new URLSearchParams({
    spaces: "appDataFolder",
    q: `name='${driveFileName}' and trashed=false`,
    fields: "files(id,name,modifiedTime)",
    pageSize: "1"
  });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const payload = (await response.json()) as DriveListResponse;
  return payload.files?.[0] ?? null;
}

async function driveFetch(url: string, init: RequestInit = {}) {
  if (!accessToken) throw new Error("Google Drive is not connected.");
  const response = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`Google Drive request failed: ${response.status}`);
  }

  return response;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${gisScriptUrl}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google sign-in script failed to load.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = gisScriptUrl;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in script failed to load."));
    document.head.appendChild(script);
  });
}
