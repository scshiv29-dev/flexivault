/* Inline autofill suggestions: host-matched, decrypted in the worker only. */

import { base64ToBytes, decryptItem, importVaultKey } from "./src/crypto.js";
import { generateTotp } from "./src/otp.js";
import { siteHost } from "./src/presentation.js";
import {
  CACHE_KEY,
  CONFIG_KEY,
  isSessionFresh,
  local,
  session,
} from "./src/store.js";

const MAX_SUGGESTIONS = 6;
const TOUCH_INTERVAL_MS = 15_000;
let lastTouchAt = 0;

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

async function readVault() {
  const [stored, storedSession] = await Promise.all([
    local.get([CONFIG_KEY, CACHE_KEY]),
    session.get(),
  ]);

  const config = stored[CONFIG_KEY] ?? null;
  const cache = stored[CACHE_KEY] ?? { items: [] };
  if (!config) {
    return { configured: false, locked: false, items: [], vaultSession: null };
  }
  if (!storedSession?.encryptionKeyB64 || !isSessionFresh(storedSession)) {
    return { configured: true, locked: true, items: [], vaultSession: null };
  }

  let key;
  try {
    key = await importVaultKey(base64ToBytes(storedSession.encryptionKeyB64));
  } catch {
    return { configured: true, locked: true, items: [], vaultSession: null };
  }

  const items = [];
  for (const row of cache.items ?? []) {
    if (!row?.data) continue;
    try {
      const item = await decryptItem(key, row.data);
      if (item && !item.deletedAt) items.push(item);
    } catch {
      // A corrupt or foreign row must not break every other suggestion.
    }
  }

  return {
    configured: true,
    locked: false,
    items,
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
      if (kind === "otp") return Boolean(item.totp?.secret);
      return item.type === "login" && Boolean(item.password);
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

    const item = candidates(vault, host, kind).find((entry) => entry.id === id);
    if (!item) {
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
