import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";
import { decideRegistration, emailAllowed, isLocalAddress, sanitiseRules } from "../src/signup.js";

test("email filters match exact domains, wildcards and listed addresses", () => {
  const rules = { allowedDomains: ["example.com", "*.corp.org"], allowedEmails: ["friend@gmail.com"] };
  assert.equal(emailAllowed("a@example.com", rules), true);
  assert.equal(emailAllowed("a@mail.example.com", rules), false);
  assert.equal(emailAllowed("a@corp.org", rules), true);
  assert.equal(emailAllowed("a@eu.corp.org", rules), true);
  assert.equal(emailAllowed("a@notcorp.org", rules), false);
  assert.equal(emailAllowed("friend@gmail.com", rules), true);
  assert.equal(emailAllowed("other@gmail.com", rules), false);
  assert.equal(emailAllowed("anyone@anywhere.io", {}), true);
});

test("local addresses cover loopback and private ranges only", () => {
  for (const ip of ["127.0.0.1", "::1", "::ffff:192.168.1.9", "10.2.3.4", "172.16.0.1", "172.31.9.9", "169.254.1.1", "fd12::1", "fe80::1"]) {
    assert.equal(isLocalAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.32.0.1", "192.169.1.1", "2001:db8::1", "", "unknown"]) {
    assert.equal(isLocalAddress(ip), false, ip);
  }
});

test("registration decisions follow admin, invite, then server rules", () => {
  const rules = { registrationOpen: false, allowLocal: true, allowedDomains: ["company.com"], allowedEmails: [] };
  const base = { rules, adminEmails: ["boss@home.net"], staticCodeOk: false, ip: "8.8.8.8" };
  assert.deepEqual(decideRegistration({ ...base, email: "boss@home.net" }), { ok: true, via: "admin" });
  assert.equal(decideRegistration({ ...base, email: "x@company.com" }), null);
  assert.equal(decideRegistration({ ...base, email: "x@company.com", ip: "192.168.1.4" }).via, "local");
  assert.equal(decideRegistration({ ...base, email: "x@gmail.com", ip: "192.168.1.4" }).code, "email_not_allowed");
  // An invite overrides the server-wide filters but keeps its own.
  assert.equal(decideRegistration({ ...base, email: "x@gmail.com", invite: { email: null, domains: "" } }).via, "invite");
  assert.equal(decideRegistration({ ...base, email: "x@gmail.com", invite: { email: "y@gmail.com" } }).code, "email_not_allowed");
  assert.equal(decideRegistration({ ...base, email: "x@gmail.com", invite: { domains: "family.net" } }).code, "email_not_allowed");
});

test("rule validation rejects bad domains and emails", () => {
  assert.match(sanitiseRules({ allowedDomains: "not a domain!" }, {}).error, /not a valid domain/);
  assert.match(sanitiseRules({ allowedEmails: "nope" }, {}).error, /not a valid email/);
  assert.deepEqual(sanitiseRules({ allowedDomains: "@Example.com\n*.corp.org" }, {}).rules.allowedDomains, [
    "example.com",
    "*.corp.org",
  ]);
});

/* ------------------------------------------------------------ HTTP flow */

let app;
let baseUrl;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), "flexivault-signup-"));
  app = createApp({
    dataDir,
    quiet: true,
    registrationOpen: false,
    adminEmails: ["admin@example.com"],
    registerRateLimit: 50,
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

async function call(method, pathname, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, payload: await response.json() };
}

function account(email, extra = {}) {
  return {
    email,
    authHash: Buffer.alloc(32, email.length).toString("base64"),
    kdfSalt: Buffer.alloc(16, 5).toString("base64"),
    kdfIterations: 210000,
    ...extra,
  };
}

let adminToken;

test("only admin emails can register while sign-up is closed", async () => {
  const info = await call("GET", "/api/server-info");
  assert.equal(info.payload.registrationOpen, false);
  assert.equal(info.payload.inviteRequired, true);

  const stranger = await call("POST", "/api/accounts/register", { body: account("someone@example.com") });
  assert.equal(stranger.status, 403);
  assert.equal(stranger.payload.code, "invite_required");

  // From 127.0.0.1, but local sign-up is off by default.
  const admin = await call("POST", "/api/accounts/register", { body: account("admin@example.com") });
  assert.equal(admin.status, 201);
  assert.equal(admin.payload.isAdmin, true);
  adminToken = admin.payload.token;
});

test("admin invite links are single-use and honour their email lock", async () => {
  const created = await call("POST", "/api/admin/invites", {
    token: adminToken,
    body: { email: "sam@gmail.com", maxUses: 5, expiresInDays: 3, note: "Sam" },
  });
  assert.equal(created.status, 201);
  assert.match(created.payload.token, /^fvi_/);
  assert.match(created.payload.url, /\/app\/#\/join\/fvi_/);
  assert.equal(created.payload.invite.maxUses, 1, "an email lock forces single use");
  const token = created.payload.token;

  const lookup = await call("GET", `/api/invites/${token}`);
  assert.equal(lookup.status, 200);
  assert.equal(lookup.payload.email, "sam@gmail.com");

  const wrongEmail = await call("POST", "/api/accounts/register", {
    body: account("eve@gmail.com", { inviteCode: token }),
  });
  assert.equal(wrongEmail.payload.code, "email_not_allowed");

  const ok = await call("POST", "/api/accounts/register", { body: account("sam@gmail.com", { inviteCode: token }) });
  assert.equal(ok.status, 201);
  assert.equal(ok.payload.isAdmin, false);

  const again = await call("POST", "/api/accounts/register", { body: account("sam2@gmail.com", { inviteCode: token }) });
  assert.equal(again.payload.code, "invalid_invite");
  assert.equal((await call("GET", `/api/invites/${token}`)).status, 404);

  // The connect page also stops accepting a used link.
  const page = await fetch(`${baseUrl}/connect?invite=${token}`);
  assert.equal(page.status, 403);

  const forbidden = await call("GET", "/api/admin/overview", { token: ok.payload.token });
  assert.equal(forbidden.status, 403);
});

test("domain invites, revocation and multi-use counting", async () => {
  const created = await call("POST", "/api/admin/invites", {
    token: adminToken,
    body: { domains: "family.net", maxUses: 2 },
  });
  const token = created.payload.token;
  const outside = await call("POST", "/api/accounts/register", { body: account("x@gmail.com", { inviteCode: token }) });
  assert.equal(outside.payload.code, "email_not_allowed");
  assert.equal((await call("POST", "/api/accounts/register", { body: account("a@family.net", { inviteCode: token }) })).status, 201);

  const revoked = await call("DELETE", `/api/admin/invites/${created.payload.invite.id}`, { token: adminToken });
  assert.equal(revoked.status, 200);
  const after = await call("POST", "/api/accounts/register", { body: account("b@family.net", { inviteCode: token }) });
  assert.equal(after.payload.code, "invalid_invite");

  const overview = await call("GET", "/api/admin/overview", { token: adminToken });
  const row = overview.payload.invites.find((invite) => invite.id === created.payload.invite.id);
  assert.equal(row.status, "revoked");
  assert.equal(row.uses, 1);
  assert.equal(overview.payload.users.length, 3);
  assert.equal(JSON.stringify(overview.payload).includes("token_hash"), false);
});

test("admin rules open sign-up with domain filters and allow local sign-up", async () => {
  const saved = await call("PUT", "/api/admin/rules", {
    token: adminToken,
    body: { registrationOpen: true, allowedDomains: "company.com", allowedEmails: "vip@gmail.com" },
  });
  assert.equal(saved.status, 200);
  assert.equal((await call("GET", "/api/server-info")).payload.registrationOpen, true);

  assert.equal((await call("POST", "/api/accounts/register", { body: account("x@other.io") })).payload.code, "email_not_allowed");
  assert.equal((await call("POST", "/api/accounts/register", { body: account("x@company.com") })).status, 201);
  assert.equal((await call("POST", "/api/accounts/register", { body: account("vip@gmail.com") })).status, 201);

  // Closed again, but tests run from 127.0.0.1, which counts as local.
  await call("PUT", "/api/admin/rules", {
    token: adminToken,
    body: { registrationOpen: false, allowLocal: true, allowedDomains: "", allowedEmails: "" },
  });
  assert.equal((await call("POST", "/api/accounts/register", { body: account("home@anything.io") })).status, 201);
  assert.equal((await fetch(`${baseUrl}/connect`)).status, 200, "local visitors see the QR page");

  // Relayed through an untrusted proxy: not local, even from 127.0.0.1.
  const proxied = await fetch(`${baseUrl}/api/accounts/register`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(account("proxied@anything.io")),
  });
  assert.equal(proxied.status, 403);
  const proxiedPage = await fetch(`${baseUrl}/connect`, { headers: { "x-forwarded-for": "203.0.113.9" } });
  assert.equal(proxiedPage.status, 403);

  const bad = await call("PUT", "/api/admin/rules", { token: adminToken, body: { allowedDomains: "bad domain" } });
  assert.equal(bad.status, 400);
});

test("admins can delete other accounts but not their own", async () => {
  const self = await call("DELETE", "/api/admin/users/admin%40example.com", { token: adminToken });
  assert.equal(self.status, 400);
  const other = await call("DELETE", "/api/admin/users/vip%40gmail.com", { token: adminToken });
  assert.equal(other.status, 200);
  const missing = await call("DELETE", "/api/admin/users/vip%40gmail.com", { token: adminToken });
  assert.equal(missing.status, 404);
});
