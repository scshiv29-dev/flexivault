import {
  hostFromUrl,
  isAndroidPackageName,
  MAX_ANDROID_PACKAGES,
} from "./autofill";
import type { VaultItem } from "./types";

export type PendingAutofillSaveMode = "create" | "update";

/**
 * A credential confirmed in the Android save overlay. It is encrypted by the
 * native Keystore queue until the vault is unlocked and can import it.
 */
export interface PendingAutofillSave {
  itemId: string;
  mode: PendingAutofillSaveMode;
  name: string;
  username?: string;
  password: string;
  hosts: string[];
  packages: string[];
  createdAt: number;
}

const MAX_PENDING_SAVES = 100;
const MAX_HOSTS = 20;
const MAX_TITLE = 200;
const MAX_USERNAME = 500;
const MAX_PASSWORD = 4096;
const ITEM_ID = /^[A-Za-z0-9_-]{8,64}$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringList(value: unknown, max: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= maxLength)
    .slice(0, max);
}

/**
 * Validates the native JSON boundary. A corrupt queue is ignored rather than
 * partially importing an item with an empty password or an oversized field.
 */
export function parsePendingAutofillSaves(json: string): PendingAutofillSave[] {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return [];
  }
  if (!root || typeof root !== "object") return [];
  const record = root as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.saves)) return [];

  const byId = new Map<string, PendingAutofillSave>();
  for (const entry of record.saves.slice(0, MAX_PENDING_SAVES)) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const itemId = text(value.itemId, 64);
    const name = text(value.name, MAX_TITLE);
    const password = typeof value.password === "string"
      ? value.password.slice(0, MAX_PASSWORD)
      : "";
    if (!itemId || !ITEM_ID.test(itemId) || !name || !password) continue;

    const hosts = stringList(value.hosts, MAX_HOSTS, 255)
      .map((host) => hostFromUrl(host))
      .filter(
        (host): host is string =>
          host !== null && (host === "localhost" || host.includes("."))
      );
    const packages = stringList(value.packages, MAX_ANDROID_PACKAGES, 200)
      .filter(isAndroidPackageName);

    const save: PendingAutofillSave = {
      itemId,
      mode: value.mode === "update" ? "update" : "create",
      name,
      username: text(value.username, MAX_USERNAME) || undefined,
      password,
      hosts: Array.from(new Set(hosts)),
      packages: Array.from(new Set(packages)),
      createdAt: Number.isFinite(Number(value.createdAt))
        ? Number(value.createdAt)
        : Date.now(),
    };
    const previous = byId.get(itemId);
    if (!previous || save.createdAt >= previous.createdAt) {
      byId.set(itemId, save);
    }
  }
  return Array.from(byId.values());
}

function urlForHost(host: string): string {
  return host === "localhost" ? "http://localhost" : `https://${host}`;
}

function mergeUnique(left: string[] | undefined, right: string[]): string[] {
  return Array.from(new Set([...(left ?? []), ...right]));
}

/**
 * Converts a queued save into a vault item. Existing rows keep their notes,
 * folder, favorite flag and TOTP seed; only the credential fields are replaced.
 */
export function mergePendingAutofillSave(
  existing: VaultItem | undefined,
  save: PendingAutofillSave,
  now = Date.now(),
): VaultItem {
  const urls = save.hosts.map(urlForHost);
  const packages = save.packages.slice(0, MAX_ANDROID_PACKAGES);

  if (existing) {
    return {
      ...existing,
      type: "login",
      name: save.name || existing.name,
      username: save.username || existing.username,
      password: save.password,
      urls: mergeUnique(existing.urls, urls),
      androidPackages: mergeUnique(existing.androidPackages, packages),
      deletedAt: undefined,
      updatedAt: now,
    };
  }

  return {
    id: save.itemId,
    type: "login",
    name: save.name || "Login",
    username: save.username,
    password: save.password,
    urls,
    androidPackages: packages,
    createdAt: save.createdAt > 0 ? save.createdAt : now,
    updatedAt: now,
  };
}
