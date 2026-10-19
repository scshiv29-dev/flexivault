export type VaultItemType = "login" | "note" | "card" | "identity" | "totp";

export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

export interface TotpConfig {
  /** Base32-encoded shared secret. */
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  issuer?: string;
  label?: string;
}

export interface CardDetails {
  number?: string;
  holder?: string;
  expiry?: string;
  cvv?: string;
  brand?: string;
}

export interface IdentityDetails {
  fullName?: string;
  email?: string;
  phone?: string;
  address?: string;
  company?: string;
  passport?: string;
}

export interface VaultItem {
  id: string;
  type: VaultItemType;
  name: string;
  username?: string;
  password?: string;
  urls?: string[];
  notes?: string;
  totp?: TotpConfig | null;
  card?: CardDetails;
  identity?: IdentityDetails;
  folder?: string;
  favorite?: boolean;
  createdAt: number;
  updatedAt: number;
  /** Tombstone — kept so deletions can sync between devices. */
  deletedAt?: number | null;
}

export interface VaultFolder {
  name: string;
  count: number;
}

export interface ServerProfile {
  email: string;
  kdfSalt: string;
  kdfIterations: number;
  totpEnabled: boolean;
  revision: number;
  createdAt: number;
}

export interface ServerSession {
  url: string;
  email: string;
  token: string | null;
  revision: number;
  totpEnabled: boolean;
}

export type ThemeMode = "system" | "light" | "dark";

export interface VaultSettings {
  autoLockMinutes: number;
  biometricsEnabled: boolean;
  themeMode: ThemeMode;
}

export interface StoredVaultItem {
  id: string;
  /** v1.<iv>.<ciphertext+tag> — see lib/vault/crypto.ts */
  data: string;
  updatedAt: number;
}

export interface LegacyTotpEntry {
  id: number;
  digits: number;
  issuer: string;
  label: string;
  period: number;
  secret: string;
}

export type SyncStatus = "idle" | "syncing" | "success" | "error" | "offline";

export interface SyncResult {
  items: VaultItem[];
  revision: number;
  pushed: boolean;
}

export const KDF_ITERATIONS = 210_000;
export const DEFAULT_AUTO_LOCK_MINUTES = 5;
