/* Quick unlock: TOTP (server-held share) and passkey (WebAuthn PRF).
 *
 * Both wrap the existing 32-byte vault key locally with AES-GCM. Neither the
 * master password nor the vault key ever reaches the server:
 * - TOTP: the wrapping key comes from a random share the server stores and
 *   releases only for this browser's device secret plus a fresh TOTP code.
 * - Passkey: the wrapping key comes from the authenticator's PRF output, which
 *   only the passkey can reproduce after user verification.
 * A wrong share/PRF fails AES-GCM, and the key check guards against a vault
 * that changed since enrolment. */
import { ApiError, api } from "./api.js";
import { base64ToBytes, bytesToBase64, keyCheck, utf8ToBytes } from "./crypto.js";

export const QUICK_KEY = "flexivault.quick-unlock";
export const TOTP_INFO = "flexivault:quick-unlock:totp:v1";
export const PASSKEY_INFO = "flexivault:quick-unlock:passkey:v1";
const REFRESH_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

export function configIdentity(config) {
  return JSON.stringify([config?.serverUrl, config?.email, config?.kdfSalt,
    config?.kdfIterations, config?.keyCheck]);
}

async function wrappingKey(secret, info) {
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8ToBytes(info) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapVaultKey(rawKey, secret, info) {
  const key = await wrappingKey(secret, info);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: utf8ToBytes(info), tagLength: 128 },
    key,
    rawKey
  );
  return `v1.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(sealed))}`;
}

export async function unwrapVaultKey(envelope, secret, info, config) {
  const parts = String(envelope ?? "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("Quick unlock is damaged. Set it up again.");
  let raw;
  try {
    raw = new Uint8Array(await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(parts[1]), additionalData: utf8ToBytes(info), tagLength: 128 },
      await wrappingKey(secret, info),
      base64ToBytes(parts[2])
    ));
  } catch {
    throw new Error("Quick unlock failed. Use your master password.");
  }
  if (raw.length !== 32 || !config?.keyCheck || (await keyCheck(raw)) !== config.keyCheck) {
    raw.fill(0);
    throw new Error("The vault changed. Unlock with your master password.");
  }
  return raw;
}

/** Returns the stored record only when it belongs to the connected vault. */
export async function readQuickUnlock(config) {
  const stored = (await chrome.storage.local.get(QUICK_KEY))[QUICK_KEY];
  if (!config || !stored || stored.identity !== configIdentity(config)) return null;
  return stored;
}

export async function writeQuickUnlock(config, patch) {
  const current = (await readQuickUnlock(config)) ?? { identity: configIdentity(config) };
  const next = { ...current, ...patch, identity: configIdentity(config) };
  if (!next.totp && !next.passkey) {
    await chrome.storage.local.remove(QUICK_KEY);
    return null;
  }
  await chrome.storage.local.set({ [QUICK_KEY]: next });
  return next;
}

export function quickMethods(quick) {
  return { totp: Boolean(quick?.totp), passkey: Boolean(quick?.passkey) };
}

/* -------------------------------- TOTP -------------------------------- */

export async function enrollTotp(config, token, rawKey, previous) {
  if (!token) throw new Error("Unlock with your master password while online first.");
  const enrolled = await api.quickUnlockEnroll(config.serverUrl, token,
    previous?.id ? { replaceId: previous.id } : {});
  const share = base64ToBytes(enrolled.share);
  try {
    return {
      id: enrolled.id,
      deviceSecret: enrolled.deviceSecret,
      expiresAt: Number(enrolled.expiresAt),
      wrapped: await wrapVaultKey(rawKey, share, TOTP_INFO),
    };
  } finally {
    share.fill(0);
  }
}

export function totpNeedsRefresh(record, now = Date.now()) {
  return Boolean(record) && Number(record.expiresAt ?? 0) - now < REFRESH_BEFORE_MS;
}

/** Codes that mean this browser's share is gone for good. */
export function isQuickUnlockGone(error) {
  return error instanceof ApiError &&
    ["quick_unlock_missing", "quick_unlock_expired", "quick_unlock_revoked"].includes(error.code);
}

export function quickErrorMessage(error) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_totp":
        return "That code did not match. Wait for the next code and try again.";
      case "quick_unlock_expired":
        return "Code unlock expired. Unlock once with your master password to renew it.";
      case "quick_unlock_revoked":
        return "Too many wrong codes. Use your master password, then turn code unlock on again.";
      case "quick_unlock_missing":
        return "Code unlock is no longer set up. Use your master password.";
      case "rate_limited":
        return "Too many attempts. Wait a few minutes or use your master password.";
      case "network_error":
      case "timeout":
        return "Could not reach your server. Use your master password or passkey.";
      default:
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "Quick unlock failed.";
}

export async function unlockWithTotp(config, record, code) {
  const value = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(value)) throw new Error("Enter the 6-digit code from your authenticator.");
  if (!record?.id || !record.deviceSecret) throw new Error("Code unlock is not set up on this browser.");
  const released = await api.quickUnlockRelease(config.serverUrl, {
    id: record.id, deviceSecret: record.deviceSecret, code: value,
  });
  const share = base64ToBytes(released.share);
  try {
    const rawKey = await unwrapVaultKey(record.wrapped, share, TOTP_INFO, config);
    return { rawKey, token: released.token ?? null };
  } finally {
    share.fill(0);
  }
}

export async function revokeTotp(config, record) {
  if (!record?.id) return;
  await api.quickUnlockRevoke(config.serverUrl, {
    id: record.id, deviceSecret: record.deviceSecret,
  }).catch(() => {});
}

/* ------------------------------- Passkey ------------------------------ */

function prfOutput(credential) {
  const first = credential?.getClientExtensionResults?.()?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/** Page-only: WebAuthn needs a focused document, not the service worker. */
export async function createPasskey(config, rawKey) {
  if (!globalThis.PublicKeyCredential || !navigator.credentials?.create) {
    throw new Error("This browser does not support passkeys.");
  }
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({ publicKey: {
    rp: { name: "FlexiVault" },
    user: {
      id: crypto.getRandomValues(new Uint8Array(16)),
      name: config.email,
      displayName: `FlexiVault · ${config.email}`,
    },
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    timeout: 120_000,
    extensions: { prf: { eval: { first: salt } } },
  } });
  if (!credential) throw new Error("Passkey setup was cancelled.");
  const results = credential.getClientExtensionResults?.()?.prf;
  let secret = prfOutput(credential);
  if (!secret) {
    if (results?.enabled === false || !results) {
      throw new Error("This passkey cannot unlock vaults (no PRF support). Try a phone, security key or Windows Hello on a recent Windows build.");
    }
    // Some authenticators enable PRF at creation but only evaluate on get().
    secret = await evaluatePasskey(new Uint8Array(credential.rawId), salt);
  }
  try {
    return {
      credentialId: bytesToBase64(new Uint8Array(credential.rawId)),
      salt: bytesToBase64(salt),
      wrapped: await wrapVaultKey(rawKey, secret, PASSKEY_INFO),
      createdAt: Date.now(),
    };
  } finally {
    secret.fill(0);
  }
}

async function evaluatePasskey(credentialId, salt) {
  if (!globalThis.PublicKeyCredential || !navigator.credentials?.get) {
    throw new Error("This browser does not support passkeys.");
  }
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    allowCredentials: [{ type: "public-key", id: credentialId }],
    userVerification: "required",
    timeout: 120_000,
    extensions: { prf: { eval: { first: salt } } },
  } });
  const secret = prfOutput(assertion);
  if (!secret) throw new Error("This passkey did not return an unlock secret.");
  return secret;
}

/** Page-only: returns the PRF output for the enrolled passkey. */
export async function passkeySecret(record) {
  if (!record?.credentialId || !record.salt) throw new Error("Passkey unlock is not set up.");
  return evaluatePasskey(base64ToBytes(record.credentialId), base64ToBytes(record.salt));
}

export async function unlockWithPasskeySecret(config, record, secret) {
  return unwrapVaultKey(record?.wrapped, secret, PASSKEY_INFO, config);
}
