/**
 * End-to-end smoke test for the extension popup.
 *
 * Boots the real FlexiVault server in-process, registers an account and seeds
 * an encrypted vault with the extension's own crypto, then drives the popup in
 * jsdom: connect, search, filters, detail, TOTP, copy, autofill, sync, lock,
 * unlock and disconnect.
 *
 * Run: node scripts/smoke-test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { createApp } from "../../server/src/app.js";
import { api } from "../src/api.js";
import {
  base64ToBytes,
  bytesToBase64,
  deriveKeys,
  encryptItem,
  importVaultKey,
  keyCheck,
} from "../src/crypto.js";
import { base32Decode, generateTotp, isValidBase32 } from "../src/otp.js";
import { sameSite, siteHost } from "../src/presentation.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const EMAIL = "ada@example.com";
const MASTER = "correct horse battery staple";
const SALT = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
const ITERATIONS = 210_000;
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const results = [];
function pass(label) {
  results.push(label);
  console.log(`  ✓ ${label}`);
}

/* ------------------------- in-memory chrome stub ------------------------- */

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
      for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
    },
    async clear() {
      values = {};
    },
    __get() {
      return { ...values };
    },
    __set(next) {
      values = { ...next };
    },
  };
}

const localArea = area();
const sessionArea = area();
const sentMessages = [];
const openedUrls = [];
const copied = [];
let activeTabUrl = "https://acme.test/login";

globalThis.chrome = {
  storage: {
    local: localArea,
    session: sessionArea,
    onChanged: { addListener() {} },
  },
  runtime: {
    getURL(value) {
      return `chrome-extension://flexivault/${value}`;
    },
  },
  tabs: {
    async query() {
      return [{ id: 7, url: activeTabUrl }];
    },
    async sendMessage(tabId, message) {
      sentMessages.push({ tabId, message });
      return { ok: true, filled: 2 };
    },
    async create({ url }) {
      openedUrls.push(url);
      return { id: 8 };
    },
  },
};

/* ------------------------------- helpers -------------------------------- */

let dom;
let document;
let window;

function query(selector) {
  return document.querySelector(selector);
}

function bodyText() {
  return document.body.textContent.replace(/\s+/g, " ").trim();
}

async function waitFor(check, label, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for ${label}\n--- visible text ---\n${bodyText().slice(0, 1200)}`
  );
}

function type(selector, value) {
  const element = query(selector);
  assert.ok(element, `missing input ${selector}`);
  element.value = value;
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function click(selector) {
  const element = query(selector);
  assert.ok(element, `missing element ${selector}`);
  element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
}

function submit(selector) {
  const form = query(selector);
  assert.ok(form, `missing form ${selector}`);
  form.dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
}

async function bootPopup(suffix = "", page = "popup.html") {
  if (dom) {
    dom.window.close();
  }
  dom = new JSDOM(await readFile(path.join(root, page), "utf8"), {
    url: `chrome-extension://flexivault/${page}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  document = dom.window.document;
  window = dom.window;

  globalThis.window = window;
  globalThis.document = document;
  Object.defineProperty(globalThis, "navigator", {
    value: window.navigator,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      async writeText(value) {
        copied.push(String(value));
      },
    },
    configurable: true,
  });

  await import(`../popup.js${suffix}`);
}

/* ------------------------------- fixtures ------------------------------- */

const dataDir = await mkdtemp(path.join(os.tmpdir(), "flexivault-extension-"));
let app;

async function startServer() {
  app = createApp({
    dataDir,
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    jwtSecret: "extension-smoke-jwt-secret-long-enough",
    encryptionSecret: "extension-smoke-encryption-secret!!",
    tokenTtlSeconds: 3600,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${app.server.address().port}`;
}

function item(id, extra) {
  const now = Date.now();
  return {
    id,
    createdAt: now - 60_000,
    updatedAt: now,
    ...extra,
  };
}

const items = [
  item("item_demo_login", {
    type: "login",
    name: "Acme Portal",
    username: "ada@example.com",
    password: "s3cret-value",
    urls: ["acme.test"],
    folder: "Work",
    notes: "Production console\nSSO is enabled",
    totp: {
      secret: TOTP_SECRET,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      issuer: "Acme",
      label: "ada@example.com",
    },
  }),
  item("item_demo_card", {
    type: "card",
    name: "Studio Card",
    card: {
      number: "4242424242424242",
      holder: "Ada Lovelace",
      expiry: "12/29",
      cvv: "123",
      brand: "Visa",
    },
  }),
  item("item_demo_note", {
    type: "note",
    name: "Recovery codes",
    notes: "one\ntwo\nthree",
  }),
];

/* --------------------------------- run ---------------------------------- */

let server;
try {
  console.log("\nExtension popup smoke test\n");

  // Pure crypto/OTP compatibility checks against Node's crypto.
  const derived = await deriveKeys(MASTER, SALT, ITERATIONS);
  assert.equal(derived.encryptionKey.length, 32);
  assert.equal(base64ToBytes(derived.authHash).length, 32);
  assert.equal((await keyCheck(derived.encryptionKey)).length, 44);
  assert.ok(isValidBase32(TOTP_SECRET));
  assert.ok(base32Decode(TOTP_SECRET).length > 0);
  const rfcCode = await generateTotp(
    { secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", algorithm: "SHA1", digits: 8, period: 30 },
    59_000
  );
  assert.equal(rfcCode, "94287082");
  assert.equal(siteHost("https://www.acme.test:8443/login"), "acme.test");
  assert.ok(sameSite("login.acme.test", "acme.test"));
  assert.ok(sameSite("https://www.acme.test", "acme.test"));
  assert.ok(!sameSite("acme.test.evil.com", "acme.test"));
  assert.ok(!sameSite("evil.test", "acme.test"));
  pass("crypto derives 64 bytes, TOTP matches RFC 6238 and host matching is strict");

  const vaultKey = await importVaultKey(derived.encryptionKey);
  const envelope = await encryptItem(vaultKey, items[0]);
  assert.match(envelope, /^v1\.[^.]+\.[^.]+$/);
  pass("item envelopes use v1.<iv>.<ciphertext+tag>");

  server = await startServer();
  const registered = await api.register(server, {
    email: EMAIL,
    authHash: derived.authHash,
    kdfSalt: SALT,
    kdfIterations: ITERATIONS,
  });
  assert.equal(registered.revision, 0);

  const stored = [];
  for (const entry of items) {
    stored.push({ id: entry.id, data: await encryptItem(vaultKey, entry) });
  }
  await api.putVault(server, registered.token, {
    baseRevision: 0,
    items: stored,
  });
  pass("server registered the account and stored three encrypted items");

  await bootPopup("?phase=setup");
  await waitFor(
    () => bodyText().includes("only ever receives ciphertext"),
    "connect screen"
  );
  pass("popup boots into the connect screen when no config exists");

  type("#serverUrl", server);
  type("#email", EMAIL);
  type("#password", MASTER);
  submit('[data-form="connect"]');
  await waitFor(() => query(".item-list"), "vault after connect", 30_000);
  await waitFor(() => bodyText().includes("Acme Portal"), "seeded login");
  assert.ok(bodyText().includes("3 items"));
  pass("connect derives keys, signs in and decrypts the synced vault");

  assert.ok(query('[data-action="open-vault"]'), "popup offers the full vault");
  click('[data-action="open-vault"]');
  await waitFor(
    () => openedUrls.includes("chrome-extension://flexivault/vault.html"),
    "full vault action"
  );
  pass("the popup exposes the dedicated full vault page");

  click('[data-action="open-item"][data-id="item_demo_login"]');
  await waitFor(() => bodyText().includes("Production console"), "detail view");
  assert.ok(bodyText().includes("ada@example.com"));
  assert.ok(!bodyText().includes("s3cret-value"), "password starts masked");
  const code = await waitFor(
    () => {
      const value = query("#totp-code")?.textContent?.trim();
      return /^\d{3} \d{3}$/.test(value ?? "") ? value : null;
    },
    "six-digit TOTP code"
  );
  assert.ok(query("#totp-remaining")?.textContent?.match(/^\d+s$/));
  pass(`detail renders masked fields and a live TOTP (${code})`);

  click('[data-action="reveal"][data-key="item_demo_login:password"]');
  await waitFor(() => bodyText().includes("s3cret-value"), "revealed password");
  click('[data-action="copy"][data-field="password"]');
  await waitFor(() => copied.includes("s3cret-value"), "clipboard write");
  pass("reveal and copy expose the password on demand");

  click('[data-action="fill"]');
  await waitFor(() => sentMessages.length === 1, "autofill message");
  assert.equal(sentMessages[0].tabId, 7);
  assert.equal(sentMessages[0].message.username, "ada@example.com");
  assert.equal(sentMessages[0].message.password, "s3cret-value");
  pass("autofill sends credentials to the content script");

  activeTabUrl = "https://evil.test/login";
  click('[data-action="fill"]');
  await waitFor(
    () => query("#toast")?.textContent?.includes("saved for"),
    "blocked autofill toast"
  );
  assert.equal(sentMessages.length, 1, "mismatched host must not receive credentials");
  activeTabUrl = "https://acme.test/login";
  pass("autofill refuses a tab whose hostname does not match the saved site");

  const openedBefore = openedUrls.length;
  click('[data-action="open-url"]');
  await waitFor(() => openedUrls.length === openedBefore + 1, "open site");
  assert.equal(openedUrls.at(-1), "https://acme.test");
  pass("open site adds a scheme when the stored URL lacks one");

  click('[data-action="back"]');
  await waitFor(() => query(".item-list"), "back to vault");

  type('[data-field="query"]', "zzz");
  await waitFor(() => bodyText().includes("Nothing matches"), "empty search state");
  click('[data-action="clear-filters"]');
  await waitFor(() => bodyText().includes("Acme Portal"), "cleared search");
  click('[data-action="filter"][data-filter="card"]');
  await waitFor(
    () => bodyText().includes("Studio Card") && !bodyText().includes("Acme Portal"),
    "card filter"
  );
  click('[data-action="filter"][data-filter="all"]');
  await waitFor(() => bodyText().includes("Acme Portal"), "all filter");
  pass("search, empty state and type filters work");

  await bootPopup("?phase=full", "vault.html");
  await waitFor(() => bodyText().includes("Acme Portal"), "full vault");
  assert.ok(document.documentElement.classList.contains("fullpage"));
  assert.equal(query(".app")?.dataset.view, "vault");
  assert.equal(query('[data-action="open-vault"]'), null);
  click('[data-action="open-item"][data-id="item_demo_login"]');
  await waitFor(() => bodyText().includes("Production console"), "full detail");
  assert.equal(query('[data-action="fill"]'), null, "full page hides popup-only autofill");
  assert.ok(bodyText().includes("inline suggestions"), "full page explains inline autofill");
  pass("vault.html renders a full page and removes popup-only actions");

  await bootPopup("?phase=after-full");
  await waitFor(() => bodyText().includes("Acme Portal"), "popup after full page");

  click('[data-action="settings"]');
  await waitFor(() => bodyText().includes("Read-only by design."), "settings");
  assert.ok(bodyText().includes(EMAIL));
  click('.settings-row [data-action="sync"]');
  await waitFor(() => bodyText().includes("Synced just now"), "manual sync");
  pass("settings shows the connection and syncs on demand");

  click('[data-action="lock"]');
  await waitFor(() => bodyText().includes("Welcome back."), "locked view");
  assert.ok(!bodyText().includes("Acme Portal"));
  const afterLock = sessionArea.__get();
  assert.ok(afterLock["flexivault.session"]?.token, "token survives a lock");
  assert.ok(!afterLock["flexivault.session"]?.encryptionKeyB64);
  pass("locking drops the vault key but keeps the session token");

  type("#password", "not-the-password");
  submit('[data-form="unlock"]');
  await waitFor(() => bodyText().includes("incorrect"), "wrong password error");
  pass("an incorrect master password is rejected locally");

  type("#password", MASTER);
  submit('[data-form="unlock"]');
  await waitFor(() => query(".item-list"), "vault after unlock", 30_000);
  await waitFor(() => bodyText().includes("Acme Portal"), "items after unlock");
  pass("unlock re-authenticates with the stored token and restores the vault");

  // A fresh popup boot should reuse the session and cache without a password.
  await bootPopup("?phase=reopen");
  await waitFor(() => bodyText().includes("Acme Portal"), "vault after reopen");
  assert.ok(!bodyText().includes("Welcome back."));
  pass("reopening the popup restores an unlocked vault from the session");

  // A stale session should show the lock screen and retain the token.
  const session = sessionArea.__get()["flexivault.session"];
  sessionArea.__set({
    "flexivault.session": {
      ...session,
      lastActiveAt: Date.now() - 16 * 60 * 1000,
    },
  });
  await bootPopup("?phase=stale");
  await waitFor(() => bodyText().includes("Welcome back."), "stale lock screen");
  const staleSession = sessionArea.__get()["flexivault.session"];
  assert.ok(staleSession?.token, "stale boot keeps the token for re-auth");
  assert.ok(!staleSession?.encryptionKeyB64, "stale boot forgets the key");
  pass("a boot after 15 idle minutes locks but keeps the token");

  click('[data-action="setup"]');
  await waitFor(
    () => bodyText().includes("only ever receives ciphertext"),
    "connect screen from lock"
  );
  type("#password", MASTER);
  submit('[data-form="connect"]');
  await waitFor(() => query(".item-list"), "vault after reconnect", 30_000);
  click('[data-action="settings"]');
  await waitFor(() => bodyText().includes("Disconnect this browser"), "settings");
  click('[data-action="disconnect"]');
  await waitFor(() => bodyText().includes("Tap again"), "disconnect armed");
  click('[data-action="disconnect"]');
  await waitFor(
    () => bodyText().includes("only ever receives ciphertext"),
    "setup after disconnect"
  );
  assert.equal(localArea.__get()["flexivault.config"], undefined);
  assert.equal(localArea.__get()["flexivault.cache"], undefined);
  assert.equal(sessionArea.__get()["flexivault.session"], undefined);
  pass("disconnect clears config, cache and session after confirmation");

  console.log(`\n${results.length} checks passed.\n`);
} catch (error) {
  console.error("\nSmoke test failed:\n");
  console.error(error);
  process.exitCode = 1;
} finally {
  if (app) await app.close();
  if (dom) dom.window.close();
  await rm(dataDir, { recursive: true, force: true });
  // The popup installs a 1s interval; end the process explicitly.
  process.exit(process.exitCode ?? 0);
}
