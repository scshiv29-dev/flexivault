import { gcm } from "@noble/ciphers/aes";
import { pbkdf2Async } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import * as Crypto from "expo-crypto";

import { nativePbkdf2 } from "@/lib/native/pbkdf2";

import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  concatBytes,
  utf8ToBytes,
} from "./base64";
import { KDF_ITERATIONS } from "./types";

export interface DerivedKeys {
  encryptionKey: Uint8Array;
  authHash: string;
  kdfSalt: string;
  kdfIterations: number;
}

const AUTH_PERSONALISATION = utf8ToBytes("flexivault:auth:v1");

function normalisePassword(password: string): string {
  try {
    return password.normalize("NFKC");
  } catch {
    return password;
  }
}

/**
 * Stretches the master password once and splits the result into two
 * independent keys:
 *
 *  - 32-byte AES-256-GCM key used only on-device / in the extension.
 *  - authHash (base64 SHA-256 of the other half) sent to the server.
 *
 * The server never sees the master password or the encryption key. It stores an
 * scrypt hash of authHash, so a database leak still requires an expensive
 * brute-force of the original password.
 */
export async function deriveKeys(
  password: string,
  kdfSalt: string,
  kdfIterations: number = KDF_ITERATIONS
): Promise<DerivedKeys> {
  const salt = base64ToBytes(kdfSalt);
  if (salt.length < 16) throw new Error("KDF salt is too short");

  const normalised = normalisePassword(password);
  const nativeMaterial = await nativePbkdf2(
    normalised,
    bytesToBase64(salt),
    kdfIterations,
    64
  );
  const material =
    nativeMaterial ??
    (await pbkdf2Async(sha256, utf8ToBytes(normalised), salt, {
      c: kdfIterations,
      dkLen: 64,
    }));

  const encryptionKey = material.slice(0, 32);
  const authMaterial = material.slice(32, 64);
  const authHash = bytesToBase64(
    sha256(concatBytes(authMaterial, AUTH_PERSONALISATION))
  );

  return { encryptionKey, authHash, kdfSalt, kdfIterations };
}

export function createKdfSalt(): string {
  return bytesToBase64(Crypto.getRandomBytes(16));
}

export function keyCheck(encryptionKey: Uint8Array): string {
  return bytesToBase64(sha256(encryptionKey));
}

export function newItemId(): string {
  return Crypto.randomUUID();
}

export function encryptJson(encryptionKey: Uint8Array, value: unknown): string {
  const nonce = Crypto.getRandomBytes(12);
  const plaintext = utf8ToBytes(JSON.stringify(value));
  const ciphertext = gcm(encryptionKey, nonce).encrypt(plaintext);
  return `v1.${bytesToBase64(nonce)}.${bytesToBase64(ciphertext)}`;
}

export function decryptJson<T>(encryptionKey: Uint8Array, envelope: string): T {
  const [version, nonceB64, ciphertextB64, extra] = envelope.split(".");
  if (version !== "v1" || !nonceB64 || !ciphertextB64 || extra !== undefined) {
    throw new Error("Unsupported encrypted payload");
  }

  const nonce = base64ToBytes(nonceB64);
  const ciphertext = base64ToBytes(ciphertextB64);
  const plaintext = gcm(encryptionKey, nonce).decrypt(ciphertext);
  return JSON.parse(bytesToUtf8(plaintext)) as T;
}

export function encryptItem(encryptionKey: Uint8Array, item: unknown): string {
  return encryptJson(encryptionKey, item);
}

export function decryptItem<T>(encryptionKey: Uint8Array, envelope: string): T {
  return decryptJson<T>(encryptionKey, envelope);
}
