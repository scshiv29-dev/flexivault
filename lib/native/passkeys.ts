import { NativeModules, Platform } from "react-native";

import {
  parsePendingPasskeys,
  passkeySyncPayload,
  type PendingPasskey,
} from "@/lib/vault/passkeys";
import type { VaultItem } from "@/lib/vault/types";

interface NativePasskeyModule {
  isAvailable(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  readPendingPasskeys(): Promise<string>;
  clearPendingPasskeys(credentials: string[]): Promise<void>;
  syncPasskeys(payload: string): Promise<void>;
  clear(): Promise<void>;
  openSettings(): Promise<void>;
}

const nativeModule: NativePasskeyModule | undefined =
  Platform.OS === "android"
    ? (NativeModules.FlexiVaultPasskeys as NativePasskeyModule | undefined)
    : undefined;

export function hasNativePasskeys(): boolean {
  return Boolean(nativeModule);
}

export async function isPasskeyProviderAvailable(): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    return await nativeModule.isAvailable();
  } catch {
    return false;
  }
}

export async function isPasskeyProviderEnabled(): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    return await nativeModule.isEnabled();
  } catch {
    return false;
  }
}

export async function readPendingPasskeys(): Promise<PendingPasskey[]> {
  if (!nativeModule) return [];
  try {
    return parsePendingPasskeys(await nativeModule.readPendingPasskeys());
  } catch {
    return [];
  }
}

export async function clearPendingPasskeys(credentialIds: string[]): Promise<void> {
  if (!nativeModule || credentialIds.length === 0) return;
  await nativeModule.clearPendingPasskeys(credentialIds);
}

/**
 * Mirrors the decrypted vault into the native provider store. Passing tombstones
 * lets a passkey deleted on another device disappear from this device too.
 */
export async function syncNativePasskeys(items: VaultItem[]): Promise<void> {
  if (!nativeModule) return;
  const payload = passkeySyncPayload(items);
  await nativeModule.syncPasskeys(JSON.stringify(payload));
}

export async function clearNativePasskeys(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.clear();
}

export async function openPasskeySettings(): Promise<void> {
  if (!nativeModule) {
    throw new Error("Passkeys require the installed Android app, not Expo Go.");
  }
  await nativeModule.openSettings();
}
