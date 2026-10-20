import { NativeModules, Platform } from "react-native";

interface NativeQrScannerModule {
  scan(): Promise<string | null>;
  decodeImage?(uri: string): Promise<string>;
}

const nativeModule: NativeQrScannerModule | undefined =
  Platform.OS === "android"
    ? (NativeModules.FlexiVaultQrScanner as NativeQrScannerModule | undefined)
    : undefined;

type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => {
  detect(source: unknown): Promise<Array<{ rawValue?: string }>>;
};

/** True only in the native Android build that ships the ZXing scanner. */
export function hasNativeQrScanner(): boolean {
  return Boolean(nativeModule?.scan);
}

/** True when this build can decode a QR image the user picks. */
export function canImportQrImage(): boolean {
  if (nativeModule?.decodeImage) return true;
  return (
    Platform.OS === "web" &&
    typeof (globalThis as { BarcodeDetector?: unknown }).BarcodeDetector ===
      "function"
  );
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

/**
 * Decodes a QR code from an image URI selected by the user.
 *
 * Android uses ZXing on-device. On the web it uses the browser's BarcodeDetector
 * when available; browsers without it fall back to the paste/manual paths.
 */
export async function decodeQrImage(uri: string): Promise<string> {
  if (nativeModule?.decodeImage) {
    return nativeModule.decodeImage(uri);
  }

  if (Platform.OS !== "web") {
    throw new Error(
      "Uploading a QR image needs the Android app, or a browser that can read QR codes."
    );
  }

  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector;
  const createBitmap = (
    globalThis as {
      createImageBitmap?: (image: unknown) => Promise<unknown>;
    }
  ).createImageBitmap;

  if (!Detector || !createBitmap) {
    throw new Error(
      "This browser cannot read QR images. Paste the otpauth link instead."
    );
  }

  let bitmap: { close?: () => void } | undefined;
  try {
    const response = await fetch(uri);
    if (!response.ok) throw new Error("Could not open that image.");
    bitmap = (await createBitmap(await response.blob())) as {
      close?: () => void;
    };
    const detector = new Detector({ formats: ["qr_code"] });
    const codes = await detector.detect(bitmap);
    const value = codes[0]?.rawValue?.trim();
    if (!value) throw new Error("No QR code was found in that image.");
    return value;
  } finally {
    bitmap?.close?.();
  }
}
