import { NativeModules, Platform } from "react-native";

interface NativeQrScannerModule {
  scan(): Promise<string | null>;
}

const nativeModule: NativeQrScannerModule | undefined =
  Platform.OS === "android"
    ? (NativeModules.FlexiVaultQrScanner as NativeQrScannerModule | undefined)
    : undefined;

/** True only in the native Android build that ships the ZXing scanner. */
export function hasNativeQrScanner(): boolean {
  return Boolean(nativeModule?.scan);
}

/**
 * Opens the on-device QR scanner and resolves with its text, or null when the
 * user cancels. The scanner is an Android-only native module; iOS and web use
 * the manual/paste paths in the scan screen.
 */
export async function scanQrCode(): Promise<string | null> {
  if (!nativeModule) {
    throw new Error(
      "Camera scanning requires the Android app build, not Expo Go or the web."
    );
  }
  return nativeModule.scan();
}
