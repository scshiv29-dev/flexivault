import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { totp } from "../src/totp.js";

let app;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "flexivault-test-"));
  app = createApp({
    dataDir,
    port: 0,
    host: "127.0.0.1",
    quiet: true,
    jwtSecret: "test-jwt-secret-that-is-long-enough",
    encryptionSecret: "test-encryption-secret-long-enough!!",
    tokenTtlSeconds: 3600,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (app) await app.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function api(method, pathname, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

function fakeAuthHash(seed) {
  return Buffer.from(seed.padEnd(32, "x")).subarray(0, 32).toString("base64");
}

function envelope(seed) {
  const a = Buffer.from(seed).toString("base64url");
  const b = Buffer.from(`${seed}-ciphertext`).toString("base64url");
  return `v1.${a}.${b}`;
}

const account = {
  email: "ada@example.com",
  authHash: fakeAuthHash("ada-auth"),
  kdfSalt: Buffer.alloc(16, 7).toString("base64"),
  kdfIterations: 210000,
};

test("health and server info are public", async () => {
  const health = await api("GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.payload.ok, true);
  assert.equal(health.payload.name, "FlexiVault");

  const info = await api("GET", "/api/server-info");
  assert.equal(info.status, 200);
  assert.equal(info.payload.registrationOpen, true);
});

test("account registration, login and vault sync", async () => {
  const registered = await api("POST", "/api/accounts/register", { body: account });
  assert.equal(registered.status, 201);
  assert.ok(registered.payload.token);
  assert.equal(registered.payload.email, account.email);
  assert.equal(registered.payload.kdfSalt, account.kdfSalt);
  const token = registered.payload.token;

  const duplicate = await api("POST", "/api/accounts/register", { body: account });
  assert.equal(duplicate.status, 409);

  const prelogin = await api("POST", "/api/accounts/prelogin", {
    body: { email: account.email },
  });
  assert.equal(prelogin.status, 200);
  assert.equal(prelogin.payload.kdfIterations, 210000);
  assert.equal(prelogin.payload.totpEnabled, false);

  const wrong = await api("POST", "/api/accounts/login", {
    body: { email: account.email, authHash: fakeAuthHash("wrong") },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.payload.code, "invalid_credentials");

  const me = await api("GET", "/api/accounts/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.payload.email, account.email);

  const empty = await api("GET", "/api/sync", { token });
  assert.equal(empty.status, 200);
  assert.equal(empty.payload.revision, 0);
  assert.deepEqual(empty.payload.items, []);

  const item = {
    id: "item_01234567",
    data: envelope("hello"),
  };
  const pushed = await api("PUT", "/api/sync", {
    token,
    body: { baseRevision: 0, items: [item] },
  });
  assert.equal(pushed.status, 200);
  assert.equal(pushed.payload.revision, 1);

  const synced = await api("GET", "/api/sync", { token });
  assert.equal(synced.payload.revision, 1);
  assert.equal(synced.payload.items.length, 1);
  assert.equal(synced.payload.items[0].id, item.id);
  assert.equal(synced.payload.items[0].data, item.data);

  const conflict = await api("PUT", "/api/sync", {
    token,
    body: { baseRevision: 0, items: [] },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.payload.code, "revision_mismatch");
  assert.equal(conflict.payload.items.length, 1);

  const forced = await api("PUT", "/api/sync", {
    token,
    body: { baseRevision: 0, force: true, items: [] },
  });
  assert.equal(forced.status, 200);
  assert.equal(forced.payload.revision, 2);
});

test("server rejects plaintext or malformed items", async () => {
  const login = await api("POST", "/api/accounts/login", {
    body: { email: account.email, authHash: account.authHash },
  });
  const token = login.payload.token;

  const plaintext = await api("PUT", "/api/sync", {
    token,
    body: { baseRevision: 2, items: [{ id: "item_aaaaaaaa", data: "not-encrypted" }] },
  });
  assert.equal(plaintext.status, 400);
  assert.equal(plaintext.payload.code, "invalid_item");

  const duplicate = await api("PUT", "/api/sync", {
    token,
    body: {
      baseRevision: 2,
      items: [
        { id: "item_aaaaaaaa", data: envelope("a") },
        { id: "item_aaaaaaaa", data: envelope("b") },
      ],
    },
  });
  assert.equal(duplicate.status, 400);
});

test("two-factor setup, login challenge and disable", async () => {
  const login = await api("POST", "/api/accounts/login", {
    body: { email: account.email, authHash: account.authHash },
  });
  const token = login.payload.token;

  const setup = await api("POST", "/api/2fa/setup", { token });
  assert.equal(setup.status, 200);
  assert.match(setup.payload.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.payload.otpauthUrl, /^otpauth:\/\/totp\//);

  const invalid = await api("POST", "/api/2fa/enable", {
    token,
    body: { code: "000000" },
  });
  assert.equal(invalid.status, 400);

  const code = totp(setup.payload.secret);
  const enabled = await api("POST", "/api/2fa/enable", { token, body: { code } });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.payload.totpEnabled, true);

  const noCode = await api("POST", "/api/accounts/login", {
    body: { email: account.email, authHash: account.authHash },
  });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.payload.code, "totp_required");

  const wrongCode = await api("POST", "/api/accounts/login", {
    body: { email: account.email, authHash: account.authHash, totpCode: "000000" },
  });
  assert.equal(wrongCode.status, 401);

  const withCode = await api("POST", "/api/accounts/login", {
    body: {
      email: account.email,
      authHash: account.authHash,
      totpCode: totp(setup.payload.secret),
    },
  });
  assert.equal(withCode.status, 200);
  assert.ok(withCode.payload.token);

  const disabled = await api("POST", "/api/2fa/disable", {
    token,
    body: { code: totp(setup.payload.secret) },
  });
  assert.equal(disabled.status, 200);

  const plainLogin = await api("POST", "/api/accounts/login", {
    body: { email: account.email, authHash: account.authHash },
  });
  assert.equal(plainLogin.status, 200);
});
