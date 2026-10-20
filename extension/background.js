/* Inline autofill suggestions: host-matched, decrypted in the worker only. */

import { base64ToBytes, decryptItem, importVaultKey } from "./src/crypto.js";
import { generateTotp } from "./src/otp.js";
import { siteHost } from "./src/presentation.js";
import {
  CACHE_KEY,
  CONFIG_KEY,
  SESSION_KEY,
  isSessionFresh,
  local,
  session,
} from "./src/store.js";

const MAX_SUGGESTIONS = 6;
const TOUCH_INTERVAL_MS = 15_000;
const DECRYPT_BATCH_SIZE = 32;
let lastTouchAt = 0;
// Suggestion metadata and the encrypted row map stay in worker memory only.
// Passwords and TOTP secrets are decrypted per fill; every read still requires
// a fresh unlocked session, and cache changes or lock events clear this.
let decryptedVault = null;

function senderHost(sender) {
  const raw = sender?.url ?? sender?.tab?.url ?? "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return siteHost(raw);
  } catch {
    return "";
  }
}

function matchesHost(item, host) {
  return (item.urls ?? []).some((value) => {
    const saved = siteHost(value);
    if (!saved || !host) return false;
    return host === saved || host.endsWith(`.${saved}`);
  });
}

function vaultCacheKey(cache, storedSession) {
  const rows = Array.isArray(cache.items) ? cache.items : [];
  return [
    storedSession.encryptionKeyB64,
    cache.revision ?? 0,
    cache.lastSyncedAt ?? 0,
    rows.length,
    rows[0]?.id ?? "",
    rows[rows.length - 1]?.id ?? "",
  ].join(":");
}

function suggestionItem(item) {
  return {
    id: item.id,
    type: item.type,
    name: item.name,
    username: item.username,
    urls: item.urls,
    favorite: item.favorite,
    updatedAt: item.updatedAt,
    hasPassword: Boolean(item.password),
    hasTotp: Boolean(item.totp?.secret),
    totp: item.totp
      ? { issuer: item.totp.issuer, label: item.totp.label }
      : undefined,
  };
}

async function decryptRowMetadata(key, rows) {
  const items = [];
  for (let index = 0; index < rows.length; index += DECRYPT_BATCH_SIZE) {
    const batch = rows.slice(index, index + DECRYPT_BATCH_SIZE);
    const decrypted = await Promise.all(
      batch.map(async (row) => {
        if (!row?.data) return null;
        try {
          return await decryptItem(key, row.data);
        } catch {
          // A corrupt or foreign row must not break every other suggestion.
          return null;
        }
      })
    );
    for (const item of decrypted) {
      if (item && !item.deletedAt) items.push(suggestionItem(item));
    }
  }
  return items;
}

function rowsById(rows) {
  const map = new Map();
  for (const row of rows) {
    if (row?.id && row?.data) map.set(row.id, row);
  }
  return map;
}

async function readVault() {
  const [stored, storedSession] = await Promise.all([
    local.get([CONFIG_KEY, CACHE_KEY]),
    session.get(),
  ]);

  const config = stored[CONFIG_KEY] ?? null;
  const cache = stored[CACHE_KEY] ?? { items: [] };
  if (!config) {
    decryptedVault = null;
    return { configured: false, locked: false, items: [], vaultSession: null };
  }
  if (!storedSession?.encryptionKeyB64 || !isSessionFresh(storedSession)) {
    decryptedVault = null;
    return { configured: true, locked: true, items: [], vaultSession: null };
  }

  const cacheKey = vaultCacheKey(cache, storedSession);
  if (decryptedVault?.key === cacheKey) {
    return {
      configured: true,
      locked: false,
      items: decryptedVault.items,
      rows: decryptedVault.rows,
      vaultKey: decryptedVault.vaultKey,
      vaultSession: storedSession,
    };
  }

  let key;
  try {
    key = await importVaultKey(base64ToBytes(storedSession.encryptionKeyB64));
  } catch {
    decryptedVault = null;
    return { configured: true, locked: true, items: [], vaultSession: null };
  }

  const rows = Array.isArray(cache.items) ? cache.items : [];
  const items = await decryptRowMetadata(key, rows);
  const byId = rowsById(rows);
  decryptedVault = { key: cacheKey, items, rows: byId, vaultKey: key };

  return {
    configured: true,
    locked: false,
    items,
    rows: byId,
    vaultKey: key,
    vaultSession: storedSession,
  };
}

function sortMatches(items) {
  return items.slice().sort((left, right) => {
    if (Boolean(left.favorite) !== Boolean(right.favorite)) {
      return left.favorite ? -1 : 1;
    }
    return Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0);
  });
}

function candidates(vault, host, kind) {
  if (vault.locked || !host) return [];
  return sortMatches(
    vault.items.filter((item) => {
      if (!matchesHost(item, host)) return false;
      if (kind === "otp") return Boolean(item.hasTotp);
      return item.type === "login" && Boolean(item.hasPassword);
    })
  );
}

function suggestion(item) {
  return {
    id: item.id,
    name: item.name || "Untitled",
    username: item.username || "",
    issuer: item.totp?.issuer || "",
    label: item.totp?.label || "",
  };
}

async function touch() {
  if (Date.now() - lastTouchAt < TOUCH_INTERVAL_MS) return;
  const current = await session.get();
  if (!current?.encryptionKeyB64 || !isSessionFresh(current)) return;
  lastTouchAt = Date.now();
  await session.set({ ...current, lastActiveAt: lastTouchAt });
}

async function handle(message, sender) {
  const host = senderHost(sender);
  if (!host) {
    return { ok: false, error: "This page cannot request vault data." };
  }

  if (message.type === "flexivault:suggest") {
    const kind = message.kind === "otp" ? "otp" : "login";
    const vault = await readVault();
    if (!vault.configured) {
      return { ok: true, configured: false, locked: false, items: [] };
    }
    if (vault.locked) {
      return { ok: true, configured: true, locked: true, items: [] };
    }
    return {
      ok: true,
      configured: true,
      locked: false,
      items: candidates(vault, host, kind)
        .slice(0, MAX_SUGGESTIONS)
        .map(suggestion),
    };
  }

  if (message.type === "flexivault:suggest-fill") {
    const kind = message.kind === "otp" ? "otp" : "login";
    const id = String(message.id ?? "");
    const vault = await readVault();
    if (vault.locked) {
      return { ok: false, locked: true, error: "Unlock FlexiVault first." };
    }

    const candidate = candidates(vault, host, kind).find(
      (entry) => entry.id === id
    );
    const row = vault.rows?.get(id);
    if (!candidate || !row?.data) {
      return { ok: false, error: "That saved item does not match this website." };
    }

    let item;
    try {
      item = await decryptItem(vault.vaultKey, row.data);
    } catch {
      return { ok: false, error: "That saved item could not be decrypted." };
    }
    if (
      !item ||
      item.deletedAt ||
      !matchesHost(item, host) ||
      (kind === "otp"
        ? !item.totp?.secret
        : item.type !== "login" || !item.password)
    ) {
      return { ok: false, error: "That saved item does not match this website." };
    }

    if (kind === "otp") {
      const code = await generateTotp(item.totp);
      await touch();
      return {
        ok: true,
        code,
        digits: item.totp.digits ?? 6,
        period: item.totp.period ?? 30,
      };
    }

    await touch();
    return {
      ok: true,
      username: item.username ?? "",
      password: item.password ?? "",
    };
  }

  return undefined;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type !== "flexivault:suggest" &&
    message?.type !== "flexivault:suggest-fill"
  ) {
    return undefined;
  }

  handle(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) =>
      sendResponse({ ok: false, error: error.message ?? "Vault error." })
    );

  return true;
});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && (changes[CACHE_KEY] || changes[CONFIG_KEY])) {
    decryptedVault = null;
  }
  if (
    area === "session" &&
    changes[SESSION_KEY] &&
    !changes[SESSION_KEY].newValue?.encryptionKeyB64
  ) {
    decryptedVault = null;
  }
});

chrome.runtime.onSuspend?.addListener(() => {
  decryptedVault = null;
});
