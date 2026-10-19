import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "flexivault.token";
const BIOMETRIC_KEY = "flexivault.biometric_key";

export async function getSessionToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setSessionToken(token: string | null): Promise<void> {
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // Token storage failing should not lock the user out of their local vault.
  }
}

export async function getBiometricKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(BIOMETRIC_KEY);
  } catch {
    return null;
  }
}

export async function setBiometricKey(value: string | null): Promise<void> {
  try {
    if (value) await SecureStore.setItemAsync(BIOMETRIC_KEY, value);
    else await SecureStore.deleteItemAsync(BIOMETRIC_KEY);
  } catch {
    // Biometrics are an optional convenience.
  }
}
