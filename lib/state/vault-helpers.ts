import { base32Decode, isValidBase32, legacySecretToBase32 } from "@/lib/vault/otp";
import {
  LegacyTotpEntry,
  ServerSession,
  VaultItem,
} from "@/lib/vault/types";
import { newItemId } from "@/lib/vault/crypto";

export const META = {
  kdfSalt: "vault.kdfSalt",
  kdfIterations: "vault.kdfIterations",
  keyCheck: "vault.keyCheck",
  createdAt: "vault.createdAt",
  legacyImported: "vault.legacyImported",
  dirty: "vault.dirty",
  lastSyncedAt: "vault.lastSyncedAt",
  serverUrl: "server.url",
  serverEmail: "server.email",
  serverRevision: "server.revision",
  serverTotpEnabled: "server.totpEnabled",
  autoLockMinutes: "settings.autoLockMinutes",
  biometricsEnabled: "settings.biometricsEnabled",
  autofillEnabled: "settings.autofillEnabled",
  themeMode: "settings.themeMode",
} as const;

export type VaultErrorCode =
  | "invalid_password"
  | "no_vault"
  | "locked"
  | "not_connected"
  | "salt_mismatch"
  | "account_not_found"
  | "weak_master_password"
  | "biometric_unavailable"
  | "biometric_cancelled"
  | "key_mismatch"
  | "invalid_secret"
  | "invalid_input"
  | "sync_failed";

export class VaultError extends Error {
  code: VaultErrorCode;

  constructor(code: VaultErrorCode, message: string) {
    super(message);
    this.name = "VaultError";
    this.code = code;
  }
}

export interface ConnectServerInput {
  url: string;
  email: string;
  password: string;
  totpCode?: string;
  createIfMissing?: boolean;
  replaceLocal?: boolean;
  fresh?: boolean;
}

export interface ConnectServerResult {
  mode: "signed_in" | "created" | "replaced";
}

export type NewVaultItem = Omit<
  VaultItem,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

export function sortItems(items: VaultItem[]): VaultItem[] {
  return items
    .slice()
    .sort((left, right) => {
      if (Boolean(left.favorite) !== Boolean(right.favorite)) {
        return left.favorite ? -1 : 1;
      }
      return right.updatedAt - left.updatedAt;
    });
}

export function legacyItemsFrom(entries: LegacyTotpEntry[]): VaultItem[] {
  const now = Date.now();
  const items: VaultItem[] = [];

  for (const entry of entries) {
    let secret: string;
    try {
      secret = legacySecretToBase32(entry.secret);
      if (!isValidBase32(secret)) continue;
      base32Decode(secret);
    } catch {
      continue;
    }

    const issuer = entry.issuer?.trim() || "";
    const label = entry.label?.trim() || "";
    const name = [issuer, label].filter(Boolean).join(" · ") || "Authenticator";

    items.push({
      id: newItemId(),
      type: "totp",
      name,
      username: label,
      urls: [],
      notes: "",
      favorite: false,
      totp: {
        secret,
        algorithm: "SHA1",
        digits: entry.digits || 6,
        period: entry.period || 30,
        issuer,
        label,
      },
      createdAt: now,
      updatedAt: now,
    });
  }

  return items;
}

export function sessionWithToken(
  session: ServerSession | null,
  token: string | null
): ServerSession | null {
  return session ? { ...session, token } : null;
}
