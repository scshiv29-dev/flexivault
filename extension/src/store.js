/* chrome.storage helpers and vault merge logic. */

export const CONFIG_KEY = "flexivault.config";
export const CACHE_KEY = "flexivault.cache";
export const SESSION_KEY = "flexivault.session";

export const AUTO_LOCK_MS = 15 * 60 * 1000;

export const local = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },
  async set(values) {
    return chrome.storage.local.set(values);
  },
  async remove(keys) {
    return chrome.storage.local.remove(keys);
  },
  async clear() {
    return chrome.storage.local.clear();
  },
};

export const session = {
  async get() {
    const values = await chrome.storage.session.get(SESSION_KEY);
    return values[SESSION_KEY] ?? null;
  },
  async set(value) {
    await chrome.storage.session.set({ [SESSION_KEY]: value });
  },
  async clear() {
    await chrome.storage.session.remove(SESSION_KEY);
  },
};

export function isSessionFresh(value) {
  if (!value?.encryptionKeyB64) return false;
  const last = Number(value.lastActiveAt ?? value.unlockedAt ?? 0);
  return Date.now() - last < AUTO_LOCK_MS;
}

export async function touchSession(value) {
  if (!value) return value;
  const next = { ...value, lastActiveAt: Date.now() };
  await session.set(next);
  return next;
}

export function mergeItems(localItems, remoteItems) {
  const byId = new Map();
  for (const item of localItems ?? []) byId.set(item.id, item);
  for (const item of remoteItems ?? []) {
    const existing = byId.get(item.id);
    if (!existing || Number(item.updatedAt) > Number(existing.updatedAt)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) => Number(right.updatedAt) - Number(left.updatedAt)
  );
}

export function visibleItems(items) {
  return (items ?? []).filter((item) => !item.deletedAt);
}

export function countByType(items) {
  const counts = { all: items.length, login: 0, codes: 0, card: 0 };
  for (const item of items) {
    if (item.type === "login") counts.login += 1;
    if (item.totp?.secret) counts.codes += 1;
    if (item.type === "card") counts.card += 1;
  }
  return counts;
}
