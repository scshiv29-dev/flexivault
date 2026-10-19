/* FlexiVault client crypto — mirrors lib/vault/crypto.ts exactly. */

const AUTH_PERSONALISATION = new TextEncoder().encode("flexivault:auth:v1");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const KDF_ITERATIONS = 210_000;

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(index, index + chunk)
    );
  }
  return btoa(binary);
}

export function base64ToBytes(value) {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}

export function utf8ToBytes(value) {
  return encoder.encode(value);
}

export function bytesToUtf8(bytes) {
  return decoder.decode(bytes);
}

export function concatBytes(...arrays) {
  const total = arrays.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function normalisePassword(password) {
  try {
    return String(password).normalize("NFKC");
  } catch {
    return String(password);
  }
}

/**
 * PBKDF2-SHA256 (210k rounds) -> 64 bytes.
 * First half is the AES-GCM vault key; the second half is hashed into the
 * authHash the server stores as a scrypt verifier.
 */
export async function deriveKeys(password, kdfSalt, kdfIterations = KDF_ITERATIONS) {
  const salt = base64ToBytes(kdfSalt);
  if (salt.length < 16) throw new Error("The vault salt is invalid.");

  const baseKey = await crypto.subtle.importKey(
    "raw",
    utf8ToBytes(normalisePassword(password)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations: Math.max(1, Number(kdfIterations) || KDF_ITERATIONS),
      },
      baseKey,
      512
    )
  );

  const encryptionKey = bits.slice(0, 32);
  const authMaterial = bits.slice(32, 64);
  const authHash = bytesToBase64(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        concatBytes(authMaterial, AUTH_PERSONALISATION)
      )
    )
  );

  return { encryptionKey, authHash, kdfSalt, kdfIterations };
}

export async function importVaultKey(rawKey) {
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Envelope: v1.<base64 iv>.<base64 ciphertext+tag> */
export async function decryptItem(vaultKey, envelope) {
  const parts = String(envelope).split(".");
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Unsupported encrypted payload.");
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(parts[1]), tagLength: 128 },
    vaultKey,
    base64ToBytes(parts[2])
  );
  return JSON.parse(bytesToUtf8(new Uint8Array(plaintext)));
}

export async function encryptItem(vaultKey, item) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    vaultKey,
    utf8ToBytes(JSON.stringify(item))
  );
  return `v1.${bytesToBase64(nonce)}.${bytesToBase64(new Uint8Array(ciphertext))}`;
}

export function newItemId() {
  return crypto.randomUUID();
}

export async function keyCheck(rawKey) {
  return bytesToBase64(
    new Uint8Array(await crypto.subtle.digest("SHA-256", rawKey))
  );
}

export function randomBase64(byteLength = 16) {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(byteLength)));
}
