import { NativeModules, Platform } from "react-native";

import { buildAutofillPayload } from "@/lib/vault/autofill";
import {
  parsePendingAutofillSaves,
  type PendingAutofillSave,
} from "@/lib/vault/autofill-save";
import type { VaultItem } from "@/lib/vault/types";

interface NativeAutofillModule {
  isAvailable(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  configure(payload: string): Promise<void>;
  clear(): Promise<void>;
  openSettings(): Promise<void>;
  readPendingSaves(): Promise<string>;
  clearPendingSaves(ids: string[]): Promise<void>;
}

const nativeModule: NativeAutofillModule | undefined =
  Platform.OS === "android"
    ? (NativeModules.FlexiVaultAutofill as NativeAutofillModule | undefined)
    : undefined;

export function hasNativeAutofill(): boolean {
  return Boolean(nativeModule);
}

export async function isAutofillAvailable(): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    return await nativeModule.isAvailable();
  } catch {
    return false;
  }
}

export async function isAutofillEnabledOnDevice(): Promise<boolean> {
  if (!nativeModule) return false;
  try {
    return await nativeModule.isEnabled();
  } catch {
    return false;
  }
}

export async function configureAutofill(items: VaultItem[]): Promise<void> {
  if (!nativeModule) {
    throw new Error("System autofill requires the Android app build, not Expo Go.");
  }
  const payload = buildAutofillPayload(items);
  await nativeModule.configure(JSON.stringify(payload));
}

export async function clearAutofillCache(): Promise<void> {
  if (!nativeModule) return;
  await nativeModule.clear();
}

export async function readPendingAutofillSaves(): Promise<PendingAutofillSave[]> {
  if (!nativeModule) return [];
  try {
    const json = await nativeModule.readPendingSaves();
    return parsePendingAutofillSaves(json);
  } catch {
    return [];
  }
}

export async function clearPendingAutofillSaves(ids: string[]): Promise<void> {
  if (!nativeModule || ids.length === 0) return;
  await nativeModule.clearPendingSaves(ids);
}

export async function openAutofillSettings(): Promise<void> {
  if (!nativeModule) {
    throw new Error("System autofill requires the Android app build, not Expo Go.");
  }
  await nativeModule.openSettings();
}
