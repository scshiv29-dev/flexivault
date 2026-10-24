/* Local-only unlock. This module runs in the trusted extension worker, never
 * in a website's content-script context. No master password is sent to a server. */
import { bytesToBase64, decryptItem, deriveKeys, importVaultKey, keyCheck } from "./crypto.js";

export async function unlockCachedVault(config, cache, password) {
  if (typeof password !== "string" || !password || password.length > 4096) {
    throw new Error("Enter your master password.");
  }
  const iterations = Number(config?.kdfIterations ?? 210000);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 2000000) {
    throw new Error("Reconnect this vault in the extension first.");
  }
  const derived = await deriveKeys(password, config.kdfSalt, iterations);
  try {
    const check = await keyCheck(derived.encryptionKey);
    if (!config.keyCheck || check !== config.keyCheck) {
      throw new Error("That master password is incorrect.");
    }
    const key = await importVaultKey(derived.encryptionKey);
    for (const row of cache?.items ?? []) {
      // Validate the cached vault, including tombstones, before creating a
      // session. Do not overwrite any encrypted rows or pending offline saves.
      await decryptItem(key, row.data);
    }
    return bytesToBase64(derived.encryptionKey);
  } finally {
    derived.encryptionKey.fill(0);
  }
}
