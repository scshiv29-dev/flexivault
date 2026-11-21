import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { buildConnectLink } from "../src/connect-page.js";
import { encodeQr } from "../src/qr.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let app;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "flexivault-connect-"));
  app = createApp({
    dataDir,
    quiet: true,
    registrationOpen: false,
    inviteCodes: ["family-2026", "friends"],
    jwtSecret: "test-jwt-secret-that-is-long-enough",
    encryptionSecret: "test-encryption-secret-long-enough!!",
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${app.server.address().port}`;
});

after(async () => {
  if (app) await app.close();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

function account(email, extra = {}) {
  return {
    email,
    authHash: Buffer.alloc(32, email.length).toString("base64"),
    kdfSalt: Buffer.alloc(16, 3).toString("base64"),
    kdfIterations: 210000,
    ...extra,
  };
}

// fetch() refuses to send a custom Host header, so use node:http directly.
function getPage(pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${pathname}`, { headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", reject);
  });
}

async function register(body) {
  const response = await fetch(`${baseUrl}/api/accounts/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() };
}

test("connect link carries server, email and invite but never a password", () => {
  const link = buildConnectLink({
    server: "https://vault.example.com",
    email: "a+b@example.com",
    invite: "x y",
  });
  assert.equal(
    link,
    "flexivault://connect?server=https%3A%2F%2Fvault.example.com&email=a%2Bb%40example.com&invite=x+y"
  );
  const parsed = new URL(link);
  assert.equal(parsed.searchParams.get("email"), "a+b@example.com");
  assert.equal(parsed.searchParams.get("invite"), "x y");
});

test("QR encoder produces valid sizes with finder patterns", () => {
  for (const [text, size] of [["hi", 21], ["x".repeat(150), 49], ["z".repeat(1200), 133]]) {
    const m = encodeQr(text);
    assert.equal(m.length, size);
    // Top-left finder: dark ring, light ring, dark 3x3 core.
    assert.deepEqual(m[0].slice(0, 7), [true, true, true, true, true, true, true]);
    assert.deepEqual(m[1].slice(0, 7), [true, false, false, false, false, false, true]);
    assert.deepEqual(m[3].slice(0, 7), [true, false, true, true, true, false, true]);
    assert.equal(m[size - 8][8], true, "dark module");
  }
  assert.throws(() => encodeQr("z".repeat(3000)), /too long/);
});

test("connect page is private while sign-up is closed", async () => {
  const closed = await getPage("/connect", { host: "vault.example.com" });
  assert.equal(closed.status, 403);
  assert.match(closed.body, /is private/);
  assert.doesNotMatch(closed.body, /<svg/);

  const wrong = await getPage("/connect?invite=nope");
  assert.equal(wrong.status, 403);
});

test("connect page shows a QR code to holders of an invite code", async () => {
  const response = await getPage("/connect?email=Ada@Example.com&invite=friends", {
    host: "vault.example.com",
  });
  assert.equal(response.status, 200);
  assert.match(response.headers["content-type"], /text\/html/);
  assert.match(response.headers["content-security-policy"], /default-src 'none'/);
  assert.match(response.body, /<svg[^>]+aria-label="Scan to connect FlexiVault"/);
  assert.match(response.body, /http:\/\/vault\.example\.com/);
  assert.match(response.body, /ada@example\.com/);
});

test("connect page escapes what it echoes", async () => {
  const response = await getPage("/connect?invite=friends&email=%3Cb%3E@x.co");
  assert.match(response.body, /&lt;b&gt;@x\.co/);
  assert.doesNotMatch(response.body, /<b>@/);
});

test("forwarded host is ignored unless TRUST_PROXY is on", async () => {
  const { body } = await getPage("/connect?invite=friends", {
    host: "real.example.com",
    "x-forwarded-host": "evil.example.com",
  });
  assert.match(body, /real\.example\.com/);
  assert.doesNotMatch(body, /evil\.example\.com/);
});

test("web vault files are served with a strict CSP and nothing else is", async () => {
  const root = await getPage("/");
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, "/app/");
  for (const file of ["", "app.js", "app.css", "crypto.js", "otp.js", "qr.js"]) {
    const page = await getPage(`/app/${file}`);
    assert.equal(page.status, 200, file);
    assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  }
  for (const bad of ["../src/app.js", "%2e%2e/package.json", "nope.js", "sub/app.js"]) {
    assert.equal((await getPage(`/app/${bad}`)).status, 404, bad);
  }
});

test("invite codes allow registration while sign-up is closed", async () => {
  const info = await (await fetch(`${baseUrl}/api/server-info`)).json();
  assert.equal(info.registrationOpen, false);
  assert.equal(info.inviteRequired, true);

  const none = await register(account("one@example.com"));
  assert.equal(none.status, 403);
  assert.equal(none.payload.code, "invite_required");

  const wrong = await register(account("one@example.com", { inviteCode: "nope" }));
  assert.equal(wrong.status, 403);
  assert.equal(wrong.payload.code, "invalid_invite");

  const ok = await register(account("one@example.com", { inviteCode: " family-2026 " }));
  assert.equal(ok.status, 201);
  const second = await register(account("two@example.com", { inviteCode: "friends" }));
  assert.equal(second.status, 201);
});

test("users command lists and deletes accounts", () => {
  const run = (...args) =>
    execFileSync(
      process.execPath,
      ["--experimental-sqlite", "--no-warnings", path.join(here, "..", "src", "admin.js"), ...args],
      { env: { ...process.env, DATA_DIR: dataDir }, encoding: "utf8" }
    );
  const listed = run("list");
  assert.match(listed, /one@example\.com/);
  assert.match(listed, /two@example\.com/);
  assert.match(run("delete", "Two@Example.com"), /Deleted two@example\.com/);
  assert.doesNotMatch(run("list"), /two@example\.com/);
});
