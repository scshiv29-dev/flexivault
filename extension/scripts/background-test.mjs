/**
 * Background worker test: host matching, decryption, no password leaks.
 * Run: node scripts/background-test.mjs
 */
import assert from "node:assert/strict";

import { bytesToBase64, deriveKeys, encryptItem, importVaultKey, keyCheck } from "../src/crypto.js";
import { generateTotp } from "../src/otp.js";
import { CACHE_KEY, CONFIG_KEY, SESSION_KEY } from "../src/store.js";
import { PASSKEY_INFO, QUICK_KEY, TOTP_INFO, configIdentity, wrapVaultKey } from "../src/quick-unlock.js";

function area() {
  let values = {};
  return {
    async get(keys) {
      if (keys == null) return { ...values };
      const list = Array.isArray(keys) ? keys : [keys];
      const output = {};
      for (const key of list) {
        if (key in values) output[key] = values[key];
      }
      return output;
    },
    async set(next) {
      values = { ...values, ...next };
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete values[key];
    },
    async clear() {
      values = {};
    },
    __get() {
      return { ...values };
    },
  };
}

const localArea = area();
const sessionArea = area();
let listener = null;
const unlockNotifications = [];
let activeTabUrl = "https://acme.test/login";
let changeListener = null;
let nextWindowId = 500;
let activeUnlockWindowId = null;
const removedWindows = [];
let windowRemovedListener = null;

globalThis.chrome = {
  storage: { local: localArea, session: sessionArea,
    onChanged: { addListener(handler) { changeListener = handler; } } },
  tabs: {
    async get(id) { return { id, url: activeTabUrl }; },
    async sendMessage(id, message, options) { unlockNotifications.push({ id, message, options }); },
  },
  windows: {
    async create() {
      activeUnlockWindowId = ++nextWindowId;
      return { id: activeUnlockWindowId };
    },
    async remove(id) { removedWindows.push(id); },
    onRemoved: { addListener(handler) { windowRemovedListener = handler; } },
  },
  runtime: {
    id: "flexivault-test",
    getURL(path) { return `chrome-extension://flexivault-test/${path}`; },
    onMessage: {
      addListener(handler) {
        listener = handler;
      },
    },
  },
};

await import("../background.js");
assert.equal(typeof listener, "function", "the worker registers a listener");

const keyBytes = crypto.getRandomValues(new Uint8Array(32));
const vaultKey = await importVaultKey(keyBytes);
const now = Date.now();

const loginItem = {
  id: "item_acme",
  type: "login",
  name: "Acme Portal",
  username: "ada@example.com",
  password: "s3cret-value",
  urls: ["https://acme.test"],
  favorite: true,
  totp: {
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    issuer: "Acme",
    label: "ada@example.com",
  },
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

const items = [
  loginItem,
  {
    id: "item_lookalike",
    type: "login",
    name: "Lookalike",
    username: "evil@example.com",
    password: "evil-password",
    urls: ["https://evil.test"],
    updatedAt: now + 3,
  },
  {
    id: "item_subdomain",
    type: "login",
    name: "Acme Admin",
    username: "admin@example.com",
    password: "admin-password",
    urls: ["https://login.acme.test"],
    updatedAt: now + 2,
  },
  {
    id: "item_no_url",
    type: "login",
    name: "No Website",
    username: "none@example.com",
    password: "no-url-password",
    urls: [],
    updatedAt: now + 1,
  },
  {
    id: "item_deleted",
    type: "login",
    name: "Deleted",
    username: "gone@example.com",
    password: "deleted-password",
    urls: ["https://acme.test"],
    updatedAt: now + 4,
    deletedAt: now,
  },
];

async function seed() {
  const rows = [];
  for (const item of items) {
    rows.push({ id: item.id, data: await encryptItem(vaultKey, item) });
  }
  await localArea.clear();
  await localArea.set({
    [CONFIG_KEY]: {
      serverUrl: "https://vault.test",
      email: "ada@example.com",
    },
    [CACHE_KEY]: { items: rows, revision: 1, lastSyncedAt: now },
  });
  await sessionArea.clear();
  await sessionArea.set({
    [SESSION_KEY]: {
      encryptionKeyB64: bytesToBase64(keyBytes),
      unlockedAt: now,
      lastActiveAt: now,
    },
  });
}

function request(message, sender) {
  return new Promise((resolve) => {
    const keepOpen = listener(
      message,
      sender ?? {
        url: "https://acme.test/login",
        tab: { id: 1, url: "https://acme.test/login" },
      },
      resolve
    );
    assert.equal(keepOpen, true, "async suggestions keep the message channel open");
  });
}

await seed();

assert.equal(
  listener({ type: "flexivault:unrelated" }, {}, () => {}),
  undefined,
  "unrelated messages are ignored"
);

let response = await request({ type: "flexivault:suggest", kind: "login" });
assert.equal(response.ok, true);
assert.equal(response.configured, true);
assert.equal(response.locked, false);
assert.deepEqual(
  response.items.map((item) => item.id),
  ["item_acme"],
  "only the exact saved host is suggested; look-alikes, subdomain-only and deleted items are excluded"
);
assert.equal(response.items[0].username, "ada@example.com");
assert.ok(
  !Object.hasOwn(response.items[0], "password"),
  "suggestions never contain passwords"
);

response = await request(
  { type: "flexivault:suggest", kind: "login" },
  { url: "https://acme.test.evil.com/login" }
);
assert.deepEqual(response.items, [], "a look-alike host receives nothing");

response = await request(
  { type: "flexivault:suggest", kind: "login" },
  { url: "https://login.acme.test/login" }
);
assert.deepEqual(
  response.items.map((item) => item.id),
  ["item_acme", "item_subdomain"],
  "a subdomain of the saved host matches, and an exact saved subdomain matches"
);

response = await request(
  { type: "flexivault:suggest", kind: "otp" },
  { url: "https://login.acme.test/login" }
);
assert.deepEqual(
  response.items.map((item) => item.id),
  ["item_acme"],
  "only items with a TOTP secret are offered to code fields"
);

const freshItem = {
  id: "item_fresh",
  type: "login",
  name: "Fresh",
  username: "fresh@example.com",
  password: "fresh-password",
  urls: ["https://fresh.test"],
  updatedAt: Date.now(),
};
const cached = localArea.__get()[CACHE_KEY];
await localArea.set({
  [CACHE_KEY]: {
    ...cached,
    items: [
      ...cached.items,
      { id: freshItem.id, data: await encryptItem(vaultKey, freshItem) },
    ],
    revision: 2,
    lastSyncedAt: Date.now(),
  },
});
response = await request(
  { type: "flexivault:suggest", kind: "login" },
  { url: "https://fresh.test/login" }
);
assert.deepEqual(
  response.items.map((item) => item.id),
  ["item_fresh"],
  "a cache update invalidates decrypted suggestions"
);

response = await request({
  type: "flexivault:suggest-fill",
  kind: "login",
  id: "item_acme",
});
assert.equal(response.ok, true);
assert.equal(response.username, "ada@example.com");
assert.equal(response.password, "s3cret-value");

response = await request(
  {
    type: "flexivault:suggest-fill",
    kind: "login",
    id: "item_acme",
  },
  { url: "https://acme.test.evil.com/login" }
);
assert.equal(response.ok, false, "a look-alike cannot request a fill");

response = await request({
  type: "flexivault:suggest-fill",
  kind: "login",
  id: "item_subdomain",
});
assert.equal(
  response.ok,
  false,
  "an item saved for a subdomain is not filled on the parent host"
);

response = await request({
  type: "flexivault:suggest-fill",
  kind: "otp",
  id: "item_acme",
});
assert.equal(response.ok, true);
const validCodes = new Set(
  await Promise.all(
    [-1, 0, 1].map((offset) =>
      generateTotp(items[0].totp, Date.now() + offset * 30_000)
    )
  )
);
assert.ok(validCodes.has(response.code), "the OTP fill returns the current code");
assert.match(response.code, /^\d{6}$/);

const touched = sessionArea.__get()[SESSION_KEY];
assert.ok(
  Number(touched.lastActiveAt) >= now,
  "a successful fill extends the session activity window"
);

let promptResponse = await request({
  type: "flexivault:save-prompt",
  username: "ada@example.com",
  password: "new-secret",
  name: "Acme Portal",
});
assert.equal(promptResponse.pending, true, "a changed password creates a pending save");
assert.equal(promptResponse.action, "update");

let pendingResponse = await request({ type: "flexivault:pending-save" });
assert.equal(pendingResponse.ok, true);
assert.equal(pendingResponse.prompt.action, "update");
assert.equal(pendingResponse.prompt.name, "Acme Portal");
assert.equal(pendingResponse.prompt.host, "acme.test");
const pendingPromptId = pendingResponse.prompt.id;
assert.ok(pendingPromptId, "the prompt carries a one-time id");
assert.ok(
  !Object.hasOwn(pendingResponse.prompt, "password"),
  "the pending prompt never returns the password to the page"
);

const lookalikePending = await request(
  { type: "flexivault:pending-save" },
  {
    url: "https://acme.test.evil.com/login",
    tab: { id: 1, url: "https://acme.test.evil.com/login" },
  }
);
assert.equal(lookalikePending.prompt, null, "a look-alike host cannot see the prompt");

const subdomainSender = {
  url: "https://login.acme.test/welcome",
  tab: { id: 1, url: "https://login.acme.test/welcome" },
};
pendingResponse = await request(
  { type: "flexivault:pending-save" },
  subdomainSender
);
assert.equal(pendingResponse.prompt?.id, pendingPromptId);
assert.equal(pendingResponse.prompt?.host, "acme.test");

const wrongPrompt = await request({
  type: "flexivault:save",
  promptId: "wrong-prompt",
});
assert.equal(wrongPrompt.ok, false, "a stale prompt id cannot save");

const saved = await request(
  {
    type: "flexivault:save",
    promptId: pendingPromptId,
  },
  subdomainSender
);
assert.equal(saved.ok, true);
assert.equal(saved.action, "update");
assert.equal(saved.id, "item_acme");
assert.equal(saved.synced, false, "the row is kept locally when sync is unavailable");

pendingResponse = await request({ type: "flexivault:pending-save" });
assert.equal(pendingResponse.prompt, null, "saving clears the pending prompt");

const updatedFill = await request({
  type: "flexivault:suggest-fill",
  kind: "login",
  id: "item_acme",
});
assert.equal(updatedFill.ok, true);
assert.equal(updatedFill.password, "new-secret", "the updated password fills immediately");

sessionArea.clear();
await sessionArea.set({
  [SESSION_KEY]: {
    encryptionKeyB64: bytesToBase64(keyBytes),
    lastActiveAt: Date.now() - 16 * 60 * 1000,
  },
});
response = await request({ type: "flexivault:suggest", kind: "login" });
assert.equal(response.locked, true, "an expired session is treated as locked");
assert.deepEqual(response.items, []);
response = await request({
  type: "flexivault:suggest-fill",
  kind: "login",
  id: "item_acme",
});
assert.equal(response.ok, false);
assert.equal(response.locked, true);

await localArea.clear();
await sessionArea.clear();
response = await request({ type: "flexivault:suggest", kind: "login" });
assert.equal(response.configured, false, "a fresh browser has no configured vault");
assert.deepEqual(response.items, []);

response = await request(
  { type: "flexivault:suggest", kind: "login" },
  { url: "chrome-extension://flexivault/vault.html" }
);
assert.equal(response.ok, false, "non-http senders cannot read the vault");

// Form unlock is a capability-scoped, extension-origin interaction. A content
// script may request the window, but cannot submit a master password to unlock.
const master = "correct horse battery staple";
const salt = bytesToBase64(new Uint8Array(16).fill(42));
const derived = await deriveKeys(master, salt, 210000);
const inlineKey = await importVaultKey(derived.encryptionKey);
const offlineCache = { items: [{ id: loginItem.id, data: await encryptItem(inlineKey, loginItem) }], dirty: true, revision: 3 };
await localArea.set({ [CONFIG_KEY]: { serverUrl: "https://vault.test", email: "ada@example.com",
  kdfSalt: salt, kdfIterations: 210000, keyCheck: await keyCheck(derived.encryptionKey) }, [CACHE_KEY]: offlineCache });
await sessionArea.set({ [SESSION_KEY]: { token: "retained-token" } });
const page = { url: activeTabUrl, frameId: 0, documentId: "login-document", tab: { id: 1, url: activeTabUrl } };
const unlockSender = (overrides = {}) => ({
  id: "flexivault-test",
  url: chrome.runtime.getURL("unlock.html"),
  frameId: 0,
  tab: { id: 900 + activeUnlockWindowId, windowId: activeUnlockWindowId },
  ...overrides,
});
const begin = () => request({ type: "flexivault:unlock-open" }, page);
response = await request({ type: "flexivault:suggest" }, page);
assert.equal(response.locked, true);
assert.deepEqual(response.items, [], "locked vault returns no identifying metadata");
let ticket = await begin();
assert.equal(ticket.ok, true);
assert.equal(typeof ticket.token, "string");
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, page);
assert.equal(response.ok, false, "content scripts cannot submit an unlock password");
response = await request({ type: "flexivault:unlock-info", token: ticket.token },
  unlockSender({ tab: { id: 2, windowId: activeUnlockWindowId + 1 } }));
assert.equal(response.ok, false, "capability cannot be used by another window");
response = await request({ type: "flexivault:unlock-info", token: ticket.token }, unlockSender());
assert.equal(response.host, "acme.test");
assert.ok(!JSON.stringify(response).includes("ada@example.com"), "unlock info reveals no vault metadata");
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: "wrong" }, unlockSender());
assert.equal(response.ok, false);
assert.ok(!sessionArea.__get()[SESSION_KEY].encryptionKeyB64, "incorrect password keeps vault locked");
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender({ frameId: 1 }));
assert.equal(response.ok, false, "capability is restricted to the trusted top-level extension page");
activeTabUrl = "https://evil.test/login";
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender());
assert.equal(response.ok, false, "navigation invalidates the form unlock");
activeTabUrl = page.url;
await request({ type: "flexivault:unlock-close", token: ticket.token }, page);
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender());
assert.equal(response.ok, false, "dismissed capabilities cannot unlock");
ticket = await begin();
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender());
assert.equal(response.ok, true);
assert.equal(sessionArea.__get()[SESSION_KEY].token, "retained-token");
assert.equal(sessionArea.__get()[SESSION_KEY].encryptionKeyB64, bytesToBase64(derived.encryptionKey));
assert.deepEqual(localArea.__get()[CACHE_KEY], offlineCache, "unlock preserves dirty/offline encrypted saves");
assert.equal(unlockNotifications.at(-1).options.documentId, "login-document");
assert.deepEqual(Object.keys(unlockNotifications.at(-1).message).sort(), ["token", "type", "unlocked"],
  "parent receives completion only, never keys or the master password");
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender());
assert.equal(response.ok, false, "successful capabilities are single-use");
response = await request({ type: "flexivault:suggest" }, page);
assert.equal(response.locked, false);
assert.equal(response.items[0].id, loginItem.id, "form suggestions resume after unlock without opening the popup");
await sessionArea.set({ [SESSION_KEY]: { token: "retained-token" } });
ticket = await begin();
const ticketName = `flexivault.inline-unlock.${ticket.token}`;
const expired = sessionArea.__get()[ticketName];
await sessionArea.set({ [ticketName]: { ...expired, createdAt: Date.now() - 121000 } });
response = await request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender());
assert.equal(response.ok, false, "expired capabilities cannot unlock");
ticket = await begin();
const pendingUnlock = request({ type: "flexivault:unlock-submit", token: ticket.token, password: master }, unlockSender());
await new Promise(resolve => setTimeout(resolve, 5));
changeListener({ [SESSION_KEY]: { newValue: { token: "retained-token" } } }, "session");
response = await pendingUnlock;
assert.equal(response.ok, false, "explicit lock during KDF cannot be undone by completion");
assert.ok(!sessionArea.__get()[SESSION_KEY].encryptionKeyB64);
assert.equal(typeof windowRemovedListener, "function", "unlock-window removal is monitored");

// Quick unlock: the same capability-bound window can unlock with a TOTP code
// (server releases a share) or a passkey PRF secret, never with a wrong one.
const quickConfig = localArea.__get()[CONFIG_KEY];
const share = crypto.getRandomValues(new Uint8Array(32));
const prf = crypto.getRandomValues(new Uint8Array(32));
await localArea.set({ [QUICK_KEY]: {
  identity: configIdentity(quickConfig),
  totp: { id: "share-id-0123456789", deviceSecret: "d".repeat(43), expiresAt: Date.now() + 864e5,
    wrapped: await wrapVaultKey(derived.encryptionKey, share, TOTP_INFO) },
  passkey: { credentialId: bytesToBase64(new Uint8Array(16).fill(5)), salt: bytesToBase64(new Uint8Array(32).fill(6)),
    wrapped: await wrapVaultKey(derived.encryptionKey, prf, PASSKEY_INFO) },
} });
const releases = [];
let releaseResponse = () => ({ status: 200, body: { share: bytesToBase64(share), token: "fresh-token" } });
globalThis.fetch = async (url, init) => {
  releases.push({ url, body: JSON.parse(init.body) });
  const { status, body } = releaseResponse();
  return { ok: status < 400, status, async text() { return JSON.stringify(body); } };
};

await sessionArea.set({ [SESSION_KEY]: { token: "retained-token" } });
ticket = await begin();
response = await request({ type: "flexivault:unlock-info", token: ticket.token }, unlockSender());
assert.equal(response.totp, true, "unlock window learns that code unlock is available");
assert.ok(response.passkey?.credentialId, "unlock window learns the passkey to ask for");
assert.ok(!JSON.stringify(response).includes("wrapped") && !JSON.stringify(response).includes("deviceSecret"),
  "unlock info never exposes the wrapped key or device secret");
response = await request({ type: "flexivault:unlock-totp", token: ticket.token, code: "123456" }, page);
assert.equal(response.ok, false, "content scripts cannot submit a code");

releaseResponse = () => ({ status: 401, body: { code: "invalid_totp", error: "Invalid two-factor code" } });
response = await request({ type: "flexivault:unlock-totp", token: ticket.token, code: "000000" }, unlockSender());
assert.equal(response.ok, false);
assert.match(response.error, /did not match/);
assert.ok(!sessionArea.__get()[SESSION_KEY].encryptionKeyB64, "a wrong code keeps the vault locked");
assert.ok(localArea.__get()[QUICK_KEY].totp, "a wrong code keeps code unlock enrolled");

releaseResponse = () => ({ status: 200, body: { share: bytesToBase64(share), token: "fresh-token" } });
response = await request({ type: "flexivault:unlock-totp", token: ticket.token, code: "123456" }, unlockSender());
assert.equal(response.ok, true);
assert.equal(releases.at(-1).url, "https://vault.test/api/quick-unlock/release");
assert.deepEqual(releases.at(-1).body, { id: "share-id-0123456789", deviceSecret: "d".repeat(43), code: "123456" });
assert.equal(sessionArea.__get()[SESSION_KEY].encryptionKeyB64, bytesToBase64(derived.encryptionKey));
assert.equal(sessionArea.__get()[SESSION_KEY].token, "fresh-token", "code unlock also signs back in");
assert.equal(unlockNotifications.at(-1).message.unlocked, true);

await sessionArea.set({ [SESSION_KEY]: { token: "retained-token" } });
ticket = await begin();
releaseResponse = () => ({ status: 410, body: { code: "quick_unlock_expired", error: "expired" } });
response = await request({ type: "flexivault:unlock-totp", token: ticket.token, code: "123456" }, unlockSender());
assert.match(response.error, /expired/);
assert.equal(localArea.__get()[QUICK_KEY].totp, null, "an expired share is forgotten locally");
assert.ok(localArea.__get()[QUICK_KEY].passkey, "passkey unlock survives a lost code share");

response = await request({ type: "flexivault:unlock-passkey", token: ticket.token,
  secret: bytesToBase64(new Uint8Array(32).fill(1)) }, unlockSender());
assert.equal(response.ok, false, "the wrong PRF secret cannot unwrap the key");
assert.ok(!sessionArea.__get()[SESSION_KEY].encryptionKeyB64);
response = await request({ type: "flexivault:unlock-passkey", token: ticket.token, secret: bytesToBase64(prf) }, page);
assert.equal(response.ok, false, "content scripts cannot submit a passkey secret");
response = await request({ type: "flexivault:unlock-passkey", token: ticket.token, secret: bytesToBase64(prf) }, unlockSender());
assert.equal(response.ok, true);
assert.equal(sessionArea.__get()[SESSION_KEY].encryptionKeyB64, bytesToBase64(derived.encryptionKey));
assert.equal(sessionArea.__get()[SESSION_KEY].token, "retained-token", "passkey unlock keeps the stored token");

// A quick-unlock record for another vault (different identity) is ignored.
await localArea.set({ [QUICK_KEY]: { ...localArea.__get()[QUICK_KEY], identity: "other" } });
await sessionArea.set({ [SESSION_KEY]: { token: "retained-token" } });
ticket = await begin();
response = await request({ type: "flexivault:unlock-info", token: ticket.token }, unlockSender());
assert.equal(response.passkey, null);
response = await request({ type: "flexivault:unlock-passkey", token: ticket.token, secret: bytesToBase64(prf) }, unlockSender());
assert.equal(response.ok, false, "quick unlock is bound to the connected vault");

console.log("Background worker checks passed.");
