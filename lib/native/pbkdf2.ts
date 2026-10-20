import { NativeModules, Platform } from "react-native";

import { base64ToBytes } from "@/lib/vault/base64";

interface NativePbkdf2Module {
  /**
   * PBKDF2-HMAC-SHA256. Returns the derived bytes as standard base64.
   * Runs on a native worker thread so Hermes stays responsive.
   */
  derive(
    password: string,
    saltBase64: string,
    iterations: number,
    length: number
  ): Promise<string>;
}

const nativeModule: NativePbkdf2Module | undefined =
  Platform.OS === "android"
    ? (NativeModules.FlexiVaultCrypto as NativePbkdf2Module | undefined)
    : undefined;

export function hasNativePbkdf2(): boolean {
  return Boolean(nativeModule);
}

/**
 * Returns null when the native module is unavailable or rejects the input, so
 * callers can fall back to the pure-JS implementation.
 */
export async function nativePbkdf2(
  password: string,
  saltBase64: string,
  iterations: number,
  length: number
): Promise<Uint8Array | null> {
  if (!nativeModule) return null;
  try {
    const encoded = await nativeModule.derive(
      password,
      saltBase64,
      iterations,
      length
    );
    if (typeof encoded !== "string" || encoded.length === 0) return null;
    const bytes = base64ToBytes(encoded);
    return bytes.length === length ? bytes : null;
  } catch {
    return null;
  }
}
