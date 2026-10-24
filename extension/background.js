/* Inline autofill suggestions: host-matched, decrypted in the worker only. */

import {
  base64ToBytes,
  decryptItem,
  encryptItem,
  importVaultKey,
  newItemId,
} from "./src/crypto.js";
import { generateTotp } from "./src/otp.js";
import { sameSite, siteHost } from "./src/presentation.js";
import { pushDirtyCache } from "./src/sync.js";
import { unlockCachedVault } from "./src/inline-unlock.js";
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
const PENDING_SAVE_PREFIX = "flexivault.pending-save.";
const PENDING_SAVE_TTL_MS = 5 * 60 * 1000;
let lastTouchAt = 0;
// Suggestion metadata and the encrypted row map stay in worker memory only.
// Passwords and TOTP secrets are decrypted per fill; every read still requires
// a fresh unlocked session, and cache changes or lock events clear this.
let decryptedVault = null;
const UNLOCK_PREFIX = "flexivault.inline-unlock.";
const UNLOCK_TTL_MS = 2 * 60 * 1000;
let unlockEpoch = 0;
const unlocking = new Set();

async function invalidateUnlockTickets() {
  const all = await chrome.storage.session.get(null);
  const names = Object.keys(all).filter((name) => name.startsWith(UNLOCK_PREFIX));
  if (names.length) await chrome.storage.session.remove(names);
  for (const name of names) {
    const ticket = all[name];
    const options = ticket.documentId ? { documentId: ticket.documentId } : { frameId: ticket.frameId };
    await chrome.tabs.sendMessage(ticket.tabId, {
      type: "flexivault:unlock-complete",
      token: name.slice(UNLOCK_PREFIX.length),
      unlocked: false,
    }, options).catch(() => {});
    if (Number.isInteger(ticket.unlockWindowId)) {
      await chrome.windows.remove(ticket.unlockWindowId).catch(() => {});
    }
  }
}

function configIdentity(config) {
  return JSON.stringify([config?.serverUrl, config?.email, config?.kdfSalt,
    config?.kdfIterations, config?.keyCheck]);
}

async function beginInlineUnlock(sender) {
  if (senderTabId(sender) == null || (sender.frameId ?? 0) !== 0) {
    return { ok: false, error: "Unlock from the main page's login form." };
  }
  const stored = await local.get(CONFIG_KEY);
  const config = stored[CONFIG_KEY];
  if (!config?.keyCheck) {
    return { ok: false, error: "Connect your vault in the extension first." };
  }
  const token = newItemId();
  const tabId = senderTabId(sender);
  const key = `${UNLOCK_PREFIX}${token}`;
  // Only one active unlock per tab. Prune old capabilities on each request.
  const all = await chrome.storage.session.get(null);
  const old = Object.keys(all).filter((name) => name.startsWith(UNLOCK_PREFIX) &&
    (all[name].tabId === tabId || Date.now() - all[name].createdAt >= UNLOCK_TTL_MS));
  for (const name of old) {
    const windowId = all[name]?.unlockWindowId;
    if (Number.isInteger(windowId)) await chrome.windows.remove(windowId).catch(() => {});
  }
  if (old.length) await chrome.storage.session.remove(old);
  await chrome.storage.session.set({ [key]: {
    tabId, frameId: sender.frameId ?? 0, documentId: sender.documentId ?? null,
    pageUrl: sender.url ?? sender.tab.url, createdAt: Date.now(),
    identity: configIdentity(config), unlockWindowId: null,
  } });
  try {
    const unlockWindow = await chrome.windows.create({
      url: `${chrome.runtime.getURL("unlock.html")}#${token}`,
      type: "popup",
      width: 400,
      height: 500,
      focused: true,
    });
    const ticket = (await chrome.storage.session.get(key))[key];
    if (!ticket || !Number.isInteger(unlockWindow.id)) throw new Error("Could not open unlock.");
    ticket.unlockWindowId = unlockWindow.id;
    await chrome.storage.session.set({ [key]: ticket });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
  }
  return { ok: true, token };
}

async function unlockTicket(message, sender) {
  // Website content scripts can request a window but cannot submit passwords,
  // access configuration or unlock the session. Only our own extension page can.
  const ownUrl = chrome.runtime.getURL("unlock.html");
  if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/)[0] !== ownUrl ||
      sender.frameId !== 0) {
    throw new Error("Use the secure FlexiVault unlock window.");
  }
  const key = `${UNLOCK_PREFIX}${String(message.token ?? "")}`;
  const ticket = (await chrome.storage.session.get(key))[key];
  if (ticket?.unlockWindowId === null && Number.isInteger(sender.tab?.windowId)) {
    // The extension page can load just before windows.create() resolves. The
    // unguessable capability binds that first trusted top-level window.
    ticket.unlockWindowId = sender.tab.windowId;
    await chrome.storage.session.set({ [key]: ticket });
  }
  if (!ticket || ticket.unlockWindowId !== sender.tab?.windowId ||
      Date.now() - ticket.createdAt >= UNLOCK_TTL_MS ||
      ticket.frameId !== 0) {
    throw new Error("This unlock request expired. Click Unlock FlexiVault again.");
  }
  const tab = await chrome.tabs.get(ticket.tabId);
  const config = (await local.get(CONFIG_KEY))[CONFIG_KEY];
  if (tab.url !== ticket.pageUrl || configIdentity(config) !== ticket.identity) {
    throw new Error("The page or vault changed. Start unlock again.");
  }
  return { key, ticket, config };
}

async function handleInlineUnlock(message, sender) {
  const { key, ticket, config } = await unlockTicket(message, sender);
  if (message.type === "flexivault:unlock-info") {
    return { ok: true, host: senderHost({ url: ticket.pageUrl }) };
  }
  if (message.type === "flexivault:unlock-cancel") {
    await chrome.storage.session.remove(key);
  } else {
    if (unlocking.has(key)) return { ok: false, error: "Unlock is already in progress." };
    unlocking.add(key);
    const epoch = unlockEpoch;
    try {
      const cache = (await local.get(CACHE_KEY))[CACHE_KEY];
      const encryptionKeyB64 = await unlockCachedVault(config, cache, message.password);
      // Revalidate after the expensive KDF: cancel, navigation, disconnect and
      // explicit lock must not be undone by an in-flight unlock.
      await unlockTicket(message, sender);
      if (epoch !== unlockEpoch) throw new Error("The vault was locked. Start unlock again.");
      const current = await session.get();
      await session.set({ encryptionKeyB64, token: current?.token ?? null,
        unlockedAt: Date.now(), lastActiveAt: Date.now() });
      decryptedVault = null;
      await chrome.storage.session.remove(key);
    } finally {
      unlocking.delete(key);
    }
  }
  const options = ticket.documentId ? { documentId: ticket.documentId } : { frameId: ticket.frameId };
  await chrome.tabs.sendMessage(ticket.tabId, {
    type: "flexivault:unlock-complete", token: message.token,
    unlocked: message.type === "flexivault:unlock-submit",
  }, options).catch(() => {});
  return { ok: true };
}

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
    cache.dirty ? 1 : 0,
    rows.length,
    rows.reduce((sum, row) => sum + Number(row?.updatedAt ?? 0), 0),
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
    return {
      configured: false,
      locked: false,
      items: [],
      vaultSession: null,
      config: null,
      cache: null,
    };
  }
  if (!storedSession?.encryptionKeyB64 || !isSessionFresh(storedSession)) {
    decryptedVault = null;
    return {
      configured: true,
      locked: true,
      items: [],
      vaultSession: null,
      config,
      cache,
    };
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
      config,
      cache,
    };
  }

  let key;
  try {
    key = await importVaultKey(base64ToBytes(storedSession.encryptionKeyB64));
  } catch {
    decryptedVault = null;
    return {
      configured: true,
      locked: true,
      items: [],
      vaultSession: null,
      config,
      cache,
    };
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
    config,
    cache,
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

function cleanUsername(value) {
  return String(value ?? "").trim().slice(0, 500);
}

function cleanPassword(value) {
  return typeof value === "string" ? value.slice(0, 4096) : "";
}

function urlForHost(host) {
  return host === "localhost" ? "http://localhost" : `https://${host}`;
}

async function findCredential(vault, host, username) {
  const wanted = cleanUsername(username).toLowerCase();
  for (const candidate of candidates(vault, host, "login")) {
    if (cleanUsername(candidate.username).toLowerCase() !== wanted) continue;
    const row = vault.rows?.get(candidate.id);
    if (!row?.data) continue;
    try {
      const item = await decryptItem(vault.vaultKey, row.data);
      if (item?.type === "login" && !item.deletedAt) return item;
    } catch {
      // A corrupt row must not block saving a different credential.
    }
  }
  return null;
}

function senderTabId(sender) {
  const id = sender?.tab?.id;
  return Number.isInteger(id) ? id : null;
}

function pendingSaveKey(tabId) {
  return `${PENDING_SAVE_PREFIX}${tabId}`;
}

async function writePendingSave(tabId, vaultKey, value) {
  if (tabId == null || !vaultKey) return;
  await chrome.storage.session.set({
    [pendingSaveKey(tabId)]: {
      createdAt: Date.now(),
      data: await encryptItem(vaultKey, value),
    },
  });
}

async function readPendingEnvelope(tabId) {
  if (tabId == null) return null;
  const key = pendingSaveKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key];
  if (!stored || typeof stored.data !== "string") return null;
  if (Date.now() - Number(stored.createdAt ?? 0) > PENDING_SAVE_TTL_MS) {
    await chrome.storage.session.remove(key);
    return null;
  }
  return stored;
}

async function readPendingSave(tabId, vaultKey) {
  if (tabId == null || !vaultKey) return null;
  const stored = await readPendingEnvelope(tabId);
  if (!stored) return null;
  try {
    const value = await decryptItem(vaultKey, stored.data);
    return value && typeof value === "object" ? value : null;
  } catch {
    await chrome.storage.session.remove(pendingSaveKey(tabId));
    return null;
  }
}

async function clearPendingSave(tabId) {
  if (tabId == null) return;
  await chrome.storage.session.remove(pendingSaveKey(tabId));
}

async function pendingSave(sender, host) {
  const tabId = senderTabId(sender);
  if (tabId == null || !(await readPendingEnvelope(tabId))) {
    return { ok: true, prompt: null };
  }
  const vault = await readVault();
  if (!vault.configured || vault.locked) {
    return { ok: true, prompt: null };
  }
  const pending = await readPendingSave(tabId, vault.vaultKey);
  if (!pending || !sameSite(pending.host, host)) {
    return { ok: true, prompt: null };
  }
  return {
    ok: true,
    prompt: {
      id: pending.id,
      action: pending.action,
      name: pending.name,
      host: pending.host,
    },
  };
}

async function dismissSave(sender, promptId) {
  const tabId = senderTabId(sender);
  if (tabId == null || !(await readPendingEnvelope(tabId))) {
    return { ok: true };
  }
  const vault = await readVault();
  if (vault.configured && !vault.locked) {
    const pending = await readPendingSave(tabId, vault.vaultKey);
    if (pending && pending.id !== String(promptId ?? "")) {
      return { ok: false, error: "This save prompt is no longer active." };
    }
  }
  await clearPendingSave(tabId);
  return { ok: true };
}

async function savePrompt(message, host, sender) {
  const tabId = senderTabId(sender);
  if (tabId != null) await clearPendingSave(tabId);
  const username = cleanUsername(message.username);
  const password = cleanPassword(message.password);
  if (!password) return { ok: true, action: "none" };

  const vault = await readVault();
  if (!vault.configured || vault.locked) {
    return {
      ok: true,
      configured: Boolean(vault.configured),
      locked: Boolean(vault.locked),
      action: "none",
    };
  }

  const existing = await findCredential(vault, host, username);
  if (existing?.password === password) {
    return { ok: true, action: "none" };
  }
  const proposed = String(message.name ?? "").trim().slice(0, 200);
  const pending = existing
    ? {
        id: newItemId(),
        action: "update",
        itemId: existing.id,
        name: existing.name || host,
        host,
        username,
        password,
      }
    : {
        id: newItemId(),
        action: "create",
        itemId: null,
        name: proposed || host,
        host,
        username,
        password,
      };
  if (tabId == null) return { ok: true, action: "none" };
  await writePendingSave(tabId, vault.vaultKey, pending);
  return { ok: true, pending: true, action: pending.action };
}


async function saveCredential(message, host, sender) {
  const vault = await readVault();
  if (vault.locked) {
    return { ok: false, locked: true, error: "Unlock FlexiVault first." };
  }
  if (!vault.config || !vault.cache) {
    return { ok: false, error: "Connect a vault before saving a login." };
  }

  const tabId = senderTabId(sender);
  const pending = await readPendingSave(tabId, vault.vaultKey);
  if (
    !pending ||
    !sameSite(pending.host, host) ||
    pending.id !== String(message.promptId ?? "")
  ) {
    return {
      ok: false,
      error: "This save prompt has expired. Submit the form again.",
    };
  }
  const targetHost = pending.host;
  const action = pending.action === "update" ? "update" : "create";
  const username = cleanUsername(pending.username);
  const password = cleanPassword(pending.password);
  if (!password) {
    await clearPendingSave(tabId);
    return { ok: false, error: "The password is empty." };
  }

  const now = Date.now();
  let item;
  if (action === "update") {
    const id = String(pending.itemId ?? "");
    const row = vault.rows?.get(id);
    if (!row?.data) {
      return { ok: false, error: "That saved login no longer exists." };
    }
    try {
      item = await decryptItem(vault.vaultKey, row.data);
    } catch {
      return { ok: false, error: "That saved login could not be decrypted." };
    }
    if (!item || item.deletedAt || !matchesHost(item, targetHost)) {
      return { ok: false, error: "That saved login does not match this website." };
    }
    item = {
      ...item,
      username: username || item.username,
      password,
      urls: Array.from(
        new Set([...(item.urls ?? []), urlForHost(targetHost)])
      ),
      updatedAt: now,
      deletedAt: null,
    };
  } else {
    const name = String(pending.name ?? "").trim().slice(0, 200) || targetHost;
    item = {
      id: newItemId(),
      type: "login",
      name,
      username: username || undefined,
      password,
      urls: [urlForHost(targetHost)],
      androidPackages: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
  }

  const row = {
    id: item.id,
    data: await encryptItem(vault.vaultKey, item),
    updatedAt: item.updatedAt,
  };
  const cache = {
    ...vault.cache,
    items: [
      ...(Array.isArray(vault.cache.items) ? vault.cache.items : []).filter(
        (entry) => entry.id !== item.id
      ),
      row,
    ],
    dirty: true,
  };

  await local.set({ [CACHE_KEY]: cache });
  decryptedVault = null;
  await clearPendingSave(tabId);

  let synced = false;
  try {
    const pushed = await pushDirtyCache({
      config: vault.config,
      session: vault.vaultSession,
      cache,
    });
    await local.set({ [CACHE_KEY]: pushed.cache });
    synced = true;
  } catch {
    // Keep the local row and dirty flag. The popup flushes it on the next open.
  }

  await touch();
  return {
    ok: true,
    action,
    id: item.id,
    name: item.name,
    synced,
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
  if (["flexivault:unlock-info", "flexivault:unlock-submit", "flexivault:unlock-cancel"].includes(message.type)) {
    return handleInlineUnlock(message, sender);
  }
  const host = senderHost(sender);
  if (!host) {
    return { ok: false, error: "This page cannot request vault data." };
  }

  if (message.type === "flexivault:unlock-open") return beginInlineUnlock(sender);
  if (message.type === "flexivault:unlock-close") {
    const key = `${UNLOCK_PREFIX}${String(message.token ?? "")}`;
    const ticket = (await chrome.storage.session.get(key))[key];
    if (ticket?.tabId === senderTabId(sender) && ticket.pageUrl === sender.url &&
        ticket.frameId === (sender.frameId ?? 0)) {
      await chrome.storage.session.remove(key);
      if (Number.isInteger(ticket.unlockWindowId)) {
        await chrome.windows.remove(ticket.unlockWindowId).catch(() => {});
      }
    }
    return { ok: true };
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

  if (message.type === "flexivault:save-prompt") {
    return savePrompt(message, host, sender);
  }

  if (message.type === "flexivault:pending-save") {
    return pendingSave(sender, host);
  }

  if (message.type === "flexivault:save") {
    return saveCredential(message, host, sender);
  }

  if (message.type === "flexivault:dismiss-save") {
    return dismissSave(sender, message.promptId);
  }

  return undefined;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    message?.type !== "flexivault:suggest" &&
    message?.type !== "flexivault:suggest-fill" &&
    message?.type !== "flexivault:save-prompt" &&
    message?.type !== "flexivault:pending-save" &&
    message?.type !== "flexivault:save" &&
    message?.type !== "flexivault:dismiss-save"
    && message?.type !== "flexivault:unlock-open"
    && message?.type !== "flexivault:unlock-info"
    && message?.type !== "flexivault:unlock-submit"
    && message?.type !== "flexivault:unlock-cancel"
    && message?.type !== "flexivault:unlock-close"
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
    if (changes[CONFIG_KEY]) {
      unlockEpoch += 1;
      void invalidateUnlockTickets();
    }
  }
  if (
    area === "session" &&
    changes[SESSION_KEY] &&
    !changes[SESSION_KEY].newValue?.encryptionKeyB64
  ) {
    decryptedVault = null;
    unlockEpoch += 1;
    void invalidateUnlockTickets();
  }
});

chrome.runtime.onSuspend?.addListener(() => {
  decryptedVault = null;
});

chrome.windows?.onRemoved?.addListener((windowId) => {
  void (async () => {
    const all = await chrome.storage.session.get(null);
    const names = Object.keys(all).filter((name) =>
      name.startsWith(UNLOCK_PREFIX) && all[name]?.unlockWindowId === windowId);
    for (const name of names) {
      const ticket = all[name];
      await chrome.storage.session.remove(name);
      const options = ticket.documentId ? { documentId: ticket.documentId } : { frameId: ticket.frameId };
      await chrome.tabs.sendMessage(ticket.tabId, {
        type: "flexivault:unlock-complete",
        token: name.slice(UNLOCK_PREFIX.length),
        unlocked: false,
      }, options).catch(() => {});
    }
  })();
});
