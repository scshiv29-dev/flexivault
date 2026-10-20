import type { PasskeyRecord, VaultItem } from "./types";

/**
 * A passkey created by the Android credential provider but not yet written to
 * the encrypted vault. The native store keeps it until the app is unlocked.
 */
export interface PendingPasskey extends PasskeyRecord {
  vaultItemId: string;
  pending: boolean;
}

export const PASSKEY_STORE_VERSION = 1;
const MAX_PENDING_PASSKEYS = 500;
const MAX_CREDENTIAL_ID_LENGTH = 1368;
const MAX_USER_HANDLE_LENGTH = 1368;
const MAX_RP_ID = 253;
const MAX_USER_NAME = 500;
const MAX_DISPLAY_NAME = 500;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const ITEM_ID = /^[A-Za-z0-9_-]{8,64}$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function base64url(value: unknown, max: number): string | null {
  const raw = text(value, max).replace(/=+$/, "");
  if (!raw || !BASE64URL.test(raw)) return null;
  return raw;
}

function p256(value: unknown): string | null {
  const raw = base64url(value, 64);
  return raw && raw.length === 43 ? raw : null;
}

function isRpId(value: string): boolean {
  if (!value || value.length > MAX_RP_ID) return false;
  if (value === "localhost") return true;
  if (!value.includes(".")) return false;
  if (value.startsWith(".") || value.endsWith(".") || value.includes("..")) {
    return false;
  }
  return /^[a-z0-9.-]+$/.test(value) && !value.includes(":") && !value.includes("/");
}

function urlForRpId(rpId: string): string {
  return rpId === "localhost" ? "http://localhost" : `https://${rpId}`;
}

function mergeUnique(left: string[] | undefined, right: string[]): string[] {
  return Array.from(new Set([...(left ?? []), ...right]));
}

function recordFromPending(pending: PendingPasskey): PasskeyRecord {
  return {
    credentialId: pending.credentialId,
    rpId: pending.rpId,
    userHandle: pending.userHandle,
    userName: pending.userName,
    displayName: pending.displayName,
    privateKey: pending.privateKey,
    publicKeyX: pending.publicKeyX,
    publicKeyY: pending.publicKeyY,
    createdAt: pending.createdAt,
    lastUsedAt: pending.lastUsedAt,
    signCount: pending.signCount,
  };
}

/**
 * Validates the native JSON boundary. Corrupt or incomplete passkeys are
 * skipped rather than imported with an unusable private key.
 */
export function parsePendingPasskeys(json: string): PendingPasskey[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return [];
  }
  if (!root || typeof root !== "object") return [];
  const value = root as Record<string, unknown>;
  if (value.version !== PASSKEY_STORE_VERSION || !Array.isArray(value.credentials)) {
    return [];
  }

  const byCredentialId = new Map<string, PendingPasskey>();
  for (const entry of value.credentials.slice(0, MAX_PENDING_PASSKEYS)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const vaultItemId = text(record.vaultItemId, 64);
    const credentialId = base64url(record.credentialId, MAX_CREDENTIAL_ID_LENGTH);
    const userHandle = base64url(record.userHandle, MAX_USER_HANDLE_LENGTH);
    const privateKey = p256(record.privateKey);
    const publicKeyX = p256(record.publicKeyX);
    const publicKeyY = p256(record.publicKeyY);
    const rpId = text(record.rpId, MAX_RP_ID).toLowerCase();
    if (!ITEM_ID.test(vaultItemId)) continue;
    if (!credentialId || !userHandle || !privateKey || !publicKeyX || !publicKeyY) {
      continue;
    }
    if (!isRpId(rpId)) continue;

    const userName = text(record.userName, MAX_USER_NAME) || rpId;
    const createdAt = Number(record.createdAt);
    const lastUsedAt = Number(record.lastUsedAt);
    const signCount = Number(record.signCount);
    const passkey: PendingPasskey = {
      vaultItemId,
      credentialId,
      rpId,
      userHandle,
      userName,
      displayName: text(record.displayName, MAX_DISPLAY_NAME) || userName,
      privateKey,
      publicKeyX,
      publicKeyY,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : undefined,
      signCount: Number.isFinite(signCount) ? Math.max(0, signCount) : 0,
      pending: record.pending !== false,
    };
    byCredentialId.set(passkey.credentialId, passkey);
  }
  return Array.from(byCredentialId.values());
}

/**
 * Creates or updates a vault item for a queued passkey. The passkey is stored
 * on a normal login row so it inherits search, folders, favorites, and the
 * existing encrypted sync path.
 */
export function mergePendingPasskey(
  existing: VaultItem | undefined,
  pending: PendingPasskey,
  now = Date.now()
): VaultItem {
  const passkey = recordFromPending(pending);
  const urls = [urlForRpId(pending.rpId)];

  if (existing) {
    return {
      ...existing,
      type: "login",
      name: existing.name || pending.displayName || pending.userName,
      username: existing.username || pending.userName,
      urls: mergeUnique(existing.urls, urls),
      passkey,
      deletedAt: undefined,
      updatedAt: now,
    };
  }

  return {
    id: pending.vaultItemId,
    type: "login",
    name: pending.displayName || pending.userName || pending.rpId,
    username: pending.userName,
    urls,
    passkey,
    createdAt: pending.createdAt,
    updatedAt: now,
  };
}

export function isPasskeyItem(item: VaultItem): boolean {
  return Boolean(item.passkey?.credentialId);
}

/**
 * The native store is a mirror, not the source of truth. The vault sends every
 * non-deleted passkey after unlock and after sync; native pending creates are
 * preserved until they are imported and cleared.
 */
export function passkeyRecordsFromItems(items: VaultItem[]): PendingPasskey[] {
  const byCredentialId = new Map<string, PendingPasskey>();
  for (const item of items) {
    if (item.deletedAt || !item.passkey) continue;
    const record = item.passkey;
    const credentialId = base64url(record.credentialId, MAX_CREDENTIAL_ID_LENGTH);
    const userHandle = base64url(record.userHandle, MAX_USER_HANDLE_LENGTH);
    const privateKey = p256(record.privateKey);
    const publicKeyX = p256(record.publicKeyX);
    const publicKeyY = p256(record.publicKeyY);
    const rpId = typeof record.rpId === "string"
      ? record.rpId.trim().toLowerCase()
      : "";
    if (!credentialId || !userHandle || !privateKey || !publicKeyX || !publicKeyY) {
      continue;
    }
    if (!isRpId(rpId) || !ITEM_ID.test(item.id)) continue;
    const userName =
      text(item.username, MAX_USER_NAME) ||
      text(record.userName, MAX_USER_NAME) ||
      rpId;
    const displayName =
      text(item.name, MAX_DISPLAY_NAME) ||
      text(record.displayName, MAX_DISPLAY_NAME) ||
      userName;
    const createdAt = Number(record.createdAt);
    const lastUsedAt = Number(record.lastUsedAt);
    const signCount = Number(record.signCount);
    byCredentialId.set(credentialId, {
      vaultItemId: item.id,
      credentialId,
      rpId,
      userHandle,
      userName,
      displayName,
      privateKey,
      publicKeyX,
      publicKeyY,
      createdAt: Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.now(),
      lastUsedAt: Number.isFinite(lastUsedAt) && lastUsedAt > 0 ? lastUsedAt : undefined,
      signCount: Number.isFinite(signCount) ? Math.max(0, signCount) : 0,
      pending: false,
    });
  }
  return Array.from(byCredentialId.values());
}

export interface PasskeySyncPayload {
  version: number;
  credentials: PendingPasskey[];
  deletedVaultItemIds: string[];
}

/**
 * The vault keeps tombstones so a passkey deleted on one device can be removed
 * from another device's native provider store.
 */
export function passkeySyncPayload(items: VaultItem[]): PasskeySyncPayload {
  const deletedVaultItemIds = Array.from(
    new Set(
      items
        .filter((item) => item.deletedAt && item.passkey && ITEM_ID.test(item.id))
        .map((item) => item.id)
    )
  );
  return {
    version: PASSKEY_STORE_VERSION,
    credentials: passkeyRecordsFromItems(items),
    deletedVaultItemIds,
  };
}

export function passkeySubtitle(item: VaultItem): string | null {
  if (!item.passkey) return null;
  return item.passkey.rpId;
}
