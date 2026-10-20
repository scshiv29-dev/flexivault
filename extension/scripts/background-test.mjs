/**
 * Background worker test: host matching, decryption, no password leaks.
 * Run: node scripts/background-test.mjs
 */
import assert from "node:assert/strict";

import { bytesToBase64, encryptItem, importVaultKey } from "../src/crypto.js";
import { generateTotp } from "../src/otp.js";
import { CACHE_KEY, CONFIG_KEY, SESSION_KEY } from "../src/store.js";

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

globalThis.chrome = {
  storage: { local: localArea, session: sessionArea },
  runtime: {
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

console.log("Background worker checks passed.");
