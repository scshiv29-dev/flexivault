import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { openDatabase } from "./db.js";
import { loadConfig } from "./config.js";
import {
  decryptString,
  encryptString,
  loadSecret,
  randomToken,
  safeEqualString,
  scryptHash,
  scryptVerify,
  signToken,
  verifyToken,
} from "./crypto.js";
import { generateTotpSecret, matchTotpStep, otpauthUrl, verifyTotp } from "./totp.js";

const JSON_LIMIT_DEFAULT = 8 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ITEM_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ENVELOPE_RE = /^v1\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/;
const SHARE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const QUICK_UNLOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const QUICK_UNLOCK_MAX_SHARES = 10;
const QUICK_UNLOCK_MAX_FAILURES = 5;

class HttpError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function normaliseEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function readString(value, name, { min = 1, max = 512 } = {}) {
  if (typeof value !== "string") {
    throw new HttpError(400, `${name} is required`, "invalid_request");
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, `${name} has an invalid length`, "invalid_request");
  }
  return trimmed;
}

function readEmail(value) {
  const email = normaliseEmail(value);
  if (email.length > 320 || !EMAIL_RE.test(email)) {
    throw new HttpError(400, "A valid email address is required", "invalid_email");
  }
  return email;
}

function readBase64(value, name, { minBytes = 16, maxBytes = 512 } = {}) {
  if (typeof value !== "string" || value.length > maxBytes * 2) {
    throw new HttpError(400, `${name} is invalid`, "invalid_request");
  }
  let buffer;
  try {
    buffer = Buffer.from(value, "base64");
  } catch {
    throw new HttpError(400, `${name} is invalid`, "invalid_request");
  }
  if (buffer.length < minBytes || buffer.length > maxBytes) {
    throw new HttpError(400, `${name} is invalid`, "invalid_request");
  }
  return buffer;
}

function readIterations(value) {
  const iterations = Number(value);
  if (!Number.isInteger(iterations) || iterations < 50_000 || iterations > 2_000_000) {
    throw new HttpError(400, "Invalid KDF iteration count", "invalid_kdf");
  }
  return iterations;
}

function readAuthHash(value) {
  const buffer = readBase64(value, "authHash", { minBytes: 32, maxBytes: 64 });
  return buffer.toString("base64");
}

async function readJson(req, maxBytes) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > maxBytes) {
    throw new HttpError(413, "Request body is too large", "body_too_large");
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new HttpError(413, "Request body is too large", "body_too_large");
    }
    chunks.push(chunk);
  }

  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "invalid_json");
  }
}

function getClientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function publicUser(user) {
  return {
    email: user.email,
    kdfSalt: user.kdf_salt,
    kdfIterations: user.kdf_iterations,
    totpEnabled: Boolean(user.totp_enabled),
    revision: user.revision,
    createdAt: user.created_at,
  };
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("base64");
}

function itemList(db, userId) {
  return db
    .prepare(
      "SELECT item_id AS id, data, updated_at AS updatedAt FROM vault_items WHERE user_id = ? ORDER BY item_id"
    )
    .all(userId)
    .map((row) => ({ id: row.id, data: row.data, updatedAt: row.updatedAt }));
}

function validateItems(items, maxItems) {
  if (!Array.isArray(items)) {
    throw new HttpError(400, "items must be an array", "invalid_request");
  }
  if (items.length > maxItems) {
    throw new HttpError(400, `A vault may contain at most ${maxItems} items`, "vault_too_large");
  }

  const seen = new Set();
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, "Invalid vault item", "invalid_item");
    }
    const id = readString(item.id, "item.id", { min: 8, max: 64 });
    if (!ITEM_ID_RE.test(id)) {
      throw new HttpError(400, "Invalid vault item id", "invalid_item");
    }
    if (seen.has(id)) {
      throw new HttpError(400, "Duplicate vault item id", "invalid_item");
    }
    seen.add(id);

    if (typeof item.data !== "string" || item.data.length > 300_000) {
      throw new HttpError(400, "Invalid encrypted vault item", "invalid_item");
    }
    if (!ENVELOPE_RE.test(item.data)) {
      throw new HttpError(400, "Vault items must be encrypted by the client", "invalid_item");
    }
    return { id, data: item.data };
  });
}

/**
 * Creates the HTTP server without starting it. Kept separate so tests can use
 * an ephemeral port and a temporary data directory.
 */
export function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = overrides.db ?? openDatabase(config.dataDir);
  const jwtSecret = loadSecret(config.jwtSecret, config.dataDir, "jwt.key");
  const encryptionKey = loadSecret(config.encryptionSecret, config.dataDir, "encryption.key");
  const maxBody = config.maxVaultBytes;

  const buckets = new Map();
  const bucketCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of buckets) {
      if (value.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);
  bucketCleanup.unref?.();

  function rateLimit(key, limit, windowMs) {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new HttpError(429, "Too many requests. Try again later.", "rate_limited");
    }
  }

  function getTotpSecret(user) {
    if (!user.totp_secret) return null;
    try {
      return decryptString(user.totp_secret, encryptionKey);
    } catch {
      return null;
    }
  }

  function issueToken(user) {
    return signToken(
      { sub: user.id, email: user.email, ver: 1 },
      jwtSecret,
      config.tokenTtlSeconds
    );
  }

  function authenticate(req) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const payload = verifyToken(token, jwtSecret);
    if (!payload?.sub) {
      throw new HttpError(401, "Authentication required", "unauthorized");
    }
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(payload.sub);
    if (!user) {
      throw new HttpError(401, "Authentication required", "unauthorized");
    }
    return user;
  }

  function markRevision(userId) {
    db.prepare("UPDATE users SET revision = revision + 1, updated_at = ? WHERE id = ?").run(
      Date.now(),
      userId
    );
    return db.prepare("SELECT revision FROM users WHERE id = ?").get(userId).revision;
  }

  async function handle(req, res, parsedUrl) {
    const { pathname } = parsedUrl;
    const method = req.method ?? "GET";
    const ip = getClientIp(req, config.trustProxy);

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "GET" && pathname === "/api/health") {
      json(res, 200, {
        ok: true,
        name: config.serverName,
        version: "1.0.0",
        time: new Date().toISOString(),
      });
      return;
    }

    if (method === "GET" && pathname === "/api/server-info") {
      json(res, 200, {
        name: config.serverName,
        version: "1.0.0",
        registrationOpen: config.registrationOpen,
        maxItems: config.maxItems,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/register") {
      rateLimit(`register:${ip}`, 10, 60 * 60 * 1000);
      if (!config.registrationOpen) {
        throw new HttpError(403, "Registration is disabled on this server", "registration_closed");
      }

      const body = await readJson(req, maxBody);
      const email = readEmail(body.email);
      const authHash = readAuthHash(body.authHash);
      const kdfSalt = readBase64(body.kdfSalt, "kdfSalt", { minBytes: 16, maxBytes: 64 }).toString(
        "base64"
      );
      const kdfIterations = readIterations(body.kdfIterations);

      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) {
        throw new HttpError(409, "An account with this email already exists", "account_exists");
      }

      const id = randomUUID();
      const authSalt = randomToken(16);
      const verifier = scryptHash(authHash, authSalt);
      const now = Date.now();

      db.prepare(
        `INSERT INTO users
          (id, email, auth_verifier, auth_salt, kdf_salt, kdf_iterations, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(id, email, verifier, authSalt, kdfSalt, kdfIterations, now, now);

      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
      json(res, 201, {
        token: issueToken(user),
        expiresIn: config.tokenTtlSeconds,
        ...publicUser(user),
        revision: 0,
      });
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/prelogin") {
      rateLimit(`prelogin:${ip}`, 60, 15 * 60 * 1000);
      const body = await readJson(req, 32 * 1024);
      const email = readEmail(body.email);
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (!user) {
        throw new HttpError(404, "No account found for this email", "account_not_found");
      }
      json(res, 200, {
        email: user.email,
        kdfSalt: user.kdf_salt,
        kdfIterations: user.kdf_iterations,
        totpEnabled: Boolean(user.totp_enabled),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/accounts/login") {
      rateLimit(`login:${ip}`, 30, 15 * 60 * 1000);
      const body = await readJson(req, 64 * 1024);
      const email = readEmail(body.email);
      const authHash = readAuthHash(body.authHash);
      const totpCode = body.totpCode ? String(body.totpCode).trim() : "";
      rateLimit(`login-email:${email}`, 15, 15 * 60 * 1000);

      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
      if (!user) {
        // Burn comparable CPU so account existence is harder to infer.
        scryptHash(authHash, randomToken(16));
        throw new HttpError(401, "Invalid email or password", "invalid_credentials");
      }

      if (!scryptVerify(authHash, user.auth_salt, user.auth_verifier)) {
        throw new HttpError(401, "Invalid email or password", "invalid_credentials");
      }

      if (user.totp_enabled) {
        if (!totpCode) {
          throw new HttpError(401, "Two-factor code required", "totp_required", {
            totpRequired: true,
          });
        }
        const secret = getTotpSecret(user);
        if (!secret || !verifyTotp(secret, totpCode)) {
          throw new HttpError(401, "Invalid two-factor code", "invalid_totp", {
            totpRequired: true,
          });
        }
      }

      json(res, 200, {
        token: issueToken(user),
        expiresIn: config.tokenTtlSeconds,
        ...publicUser(user),
      });
      return;
    }

    if (method === "GET" && pathname === "/api/accounts/me") {
      const user = authenticate(req);
      json(res, 200, publicUser(user));
      return;
    }

    if (method === "POST" && pathname === "/api/2fa/setup") {
      const user = authenticate(req);
      rateLimit(`2fa-setup:${user.id}`, 10, 60 * 60 * 1000);
      if (user.totp_enabled) {
        throw new HttpError(409, "Two-factor authentication is already enabled", "totp_enabled");
      }

      const secret = generateTotpSecret();
      db.prepare("UPDATE users SET totp_pending = ?, updated_at = ? WHERE id = ?").run(
        encryptString(secret, encryptionKey),
        Date.now(),
        user.id
      );

      json(res, 200, {
        secret,
        otpauthUrl: otpauthUrl({ secret, email: user.email }),
        digits: 6,
        period: 30,
        algorithm: "SHA1",
      });
      return;
    }

    if (method === "POST" && pathname === "/api/2fa/enable") {
      const user = authenticate(req);
      rateLimit(`2fa-enable:${user.id}`, 20, 15 * 60 * 1000);
      if (user.totp_enabled) {
        throw new HttpError(409, "Two-factor authentication is already enabled", "totp_enabled");
      }
      if (!user.totp_pending) {
        throw new HttpError(400, "Start two-factor setup first", "totp_not_started");
      }

      const body = await readJson(req, 32 * 1024);
      const code = readString(body.code, "code", { min: 6, max: 6 });
      let secret;
      try {
        secret = decryptString(user.totp_pending, encryptionKey);
      } catch {
        throw new HttpError(500, "Stored two-factor secret is unreadable", "server_key_mismatch");
      }

      if (!verifyTotp(secret, code)) {
        throw new HttpError(400, "Invalid two-factor code", "invalid_totp");
      }

      db.prepare(
        `UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled = 1, updated_at = ?
         WHERE id = ?`
      ).run(user.totp_pending, Date.now(), user.id);

      json(res, 200, { totpEnabled: true });
      return;
    }

    if (method === "POST" && pathname === "/api/2fa/disable") {
      const user = authenticate(req);
      rateLimit(`2fa-disable:${user.id}`, 10, 15 * 60 * 1000);
      if (!user.totp_enabled) {
        throw new HttpError(400, "Two-factor authentication is not enabled", "totp_disabled");
      }
      const body = await readJson(req, 32 * 1024);
      const code = readString(body.code, "code", { min: 6, max: 6 });
      const secret = getTotpSecret(user);
      if (!secret || !verifyTotp(secret, code)) {
        throw new HttpError(400, "Invalid two-factor code", "invalid_totp");
      }
      db.prepare(
        `UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled = 0, updated_at = ?
         WHERE id = ?`
      ).run(Date.now(), user.id);
      // Quick unlock depends on TOTP; disabling 2FA revokes every browser.
      db.prepare("DELETE FROM unlock_shares WHERE user_id = ?").run(user.id);
      json(res, 200, { totpEnabled: false });
      return;
    }

    if (method === "POST" && pathname === "/api/quick-unlock") {
      // Enrolment needs a signed-in session, which the client only has after a
      // master-password unlock. The share is returned once and never again
      // except through /release.
      const user = authenticate(req);
      rateLimit(`quick-enroll:${user.id}`, 20, 60 * 60 * 1000);
      if (!user.totp_enabled) {
        throw new HttpError(400, "Turn on two-factor authentication first", "totp_disabled");
      }
      const body = await readJson(req, 32 * 1024);
      const now = Date.now();
      db.exec("BEGIN IMMEDIATE");
      try {
        if (body.replaceId !== undefined) {
          const replaceId = String(body.replaceId);
          if (SHARE_ID_RE.test(replaceId)) {
            db.prepare("DELETE FROM unlock_shares WHERE id = ? AND user_id = ?").run(
              replaceId,
              user.id
            );
          }
        }
        db.prepare("DELETE FROM unlock_shares WHERE user_id = ? AND expires_at <= ?").run(
          user.id,
          now
        );
        const id = randomToken(18);
        const share = randomToken(32);
        const deviceSecret = randomToken(32);
        const expiresAt = now + QUICK_UNLOCK_TTL_MS;
        db.prepare(
          `INSERT INTO unlock_shares
            (id, user_id, share, device_verifier, last_step, failures, created_at, expires_at)
           VALUES (?, ?, ?, ?, 0, 0, ?, ?)`
        ).run(id, user.id, encryptString(share, encryptionKey), sha256(deviceSecret), now, expiresAt);
        // Keep only the newest few browsers per account.
        db.prepare(
          `DELETE FROM unlock_shares WHERE user_id = ? AND id NOT IN (
             SELECT id FROM unlock_shares WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
           )`
        ).run(user.id, user.id, QUICK_UNLOCK_MAX_SHARES);
        db.exec("COMMIT");
        json(res, 201, { id, share, deviceSecret, expiresAt });
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return;
    }

    if (method === "POST" && pathname === "/api/quick-unlock/release") {
      rateLimit(`quick-release:${ip}`, 30, 15 * 60 * 1000);
      const body = await readJson(req, 32 * 1024);
      const id = readString(body.id, "id", { min: 16, max: 64 });
      const deviceSecret = readString(body.deviceSecret, "deviceSecret", { min: 32, max: 128 });
      const code = readString(body.code, "code", { min: 6, max: 6 });
      if (!SHARE_ID_RE.test(id)) {
        throw new HttpError(404, "Quick unlock is not set up", "quick_unlock_missing");
      }
      rateLimit(`quick-release-id:${id}`, 10, 15 * 60 * 1000);

      const row = db.prepare("SELECT * FROM unlock_shares WHERE id = ?").get(id);
      if (!row || !safeEqualString(sha256(deviceSecret), row.device_verifier)) {
        throw new HttpError(404, "Quick unlock is not set up", "quick_unlock_missing");
      }
      if (row.expires_at <= Date.now()) {
        db.prepare("DELETE FROM unlock_shares WHERE id = ?").run(id);
        throw new HttpError(410, "Quick unlock expired", "quick_unlock_expired");
      }
      const user = db.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id);
      const secret = user?.totp_enabled ? getTotpSecret(user) : null;
      if (!user || !secret) {
        db.prepare("DELETE FROM unlock_shares WHERE id = ?").run(id);
        throw new HttpError(404, "Quick unlock is not set up", "quick_unlock_missing");
      }

      const step = matchTotpStep(secret, code);
      if (step < 0 || step <= row.last_step) {
        const failures = row.failures + 1;
        if (failures >= QUICK_UNLOCK_MAX_FAILURES) {
          // A stolen device secret gets a handful of guesses, then the
          // browser must unlock with the master password and enrol again.
          db.prepare("DELETE FROM unlock_shares WHERE id = ?").run(id);
          throw new HttpError(401, "Too many wrong codes. Use your master password.",
            "quick_unlock_revoked");
        }
        db.prepare("UPDATE unlock_shares SET failures = ? WHERE id = ?").run(failures, id);
        throw new HttpError(401, "Invalid two-factor code", "invalid_totp");
      }

      let share;
      try {
        share = decryptString(row.share, encryptionKey);
      } catch {
        throw new HttpError(500, "Stored unlock share is unreadable", "server_key_mismatch");
      }
      db.prepare("UPDATE unlock_shares SET last_step = ?, failures = 0 WHERE id = ?").run(step, id);
      json(res, 200, {
        share,
        token: issueToken(user),
        expiresIn: config.tokenTtlSeconds,
        ...publicUser(user),
      });
      return;
    }

    if (method === "POST" && pathname === "/api/quick-unlock/revoke") {
      rateLimit(`quick-revoke:${ip}`, 30, 15 * 60 * 1000);
      const body = await readJson(req, 32 * 1024);
      const id = String(body.id ?? "");
      const deviceSecret = String(body.deviceSecret ?? "");
      if (SHARE_ID_RE.test(id)) {
        const row = db.prepare("SELECT device_verifier FROM unlock_shares WHERE id = ?").get(id);
        if (row && safeEqualString(sha256(deviceSecret), row.device_verifier)) {
          db.prepare("DELETE FROM unlock_shares WHERE id = ?").run(id);
        }
      }
      json(res, 200, { revoked: true });
      return;
    }

    if (method === "GET" && pathname === "/api/sync") {
      const user = authenticate(req);
      json(res, 200, {
        revision: user.revision,
        items: itemList(db, user.id),
        updatedAt: user.updated_at,
      });
      return;
    }

    if (method === "PUT" && pathname === "/api/sync") {
      const user = authenticate(req);
      rateLimit(`sync:${user.id}`, 240, 15 * 60 * 1000);
      const body = await readJson(req, maxBody);
      const baseRevision = Number(body.baseRevision);
      if (!Number.isInteger(baseRevision) || baseRevision < 0) {
        throw new HttpError(400, "baseRevision is required", "invalid_request");
      }
      const items = validateItems(body.items, config.maxItems);

      if (!body.force && baseRevision !== user.revision) {
        throw new HttpError(409, "Vault changed on another device", "revision_mismatch", {
          revision: user.revision,
          items: itemList(db, user.id),
          updatedAt: user.updated_at,
        });
      }

      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM vault_items WHERE user_id = ?").run(user.id);
        const insert = db.prepare(
          "INSERT INTO vault_items (user_id, item_id, data, updated_at) VALUES (?, ?, ?, ?)"
        );
        const now = Date.now();
        for (const item of items) insert.run(user.id, item.id, item.data, now);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      const revision = markRevision(user.id);
      json(res, 200, { revision, itemCount: items.length, updatedAt: Date.now() });
      return;
    }

    throw new HttpError(404, "Not found", "not_found");
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const origin = req.headers.origin;

    if (origin && (config.corsOrigins.includes("*") || config.corsOrigins.includes(origin))) {
      res.setHeader("Access-Control-Allow-Origin", config.corsOrigins.includes("*") ? "*" : origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
      res.setHeader("Access-Control-Max-Age", "86400");
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");

    let parsedUrl;
    try {
      parsedUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      json(res, 400, { error: "Bad request", code: "bad_request" });
      return;
    }

    try {
      await handle(req, res, parsedUrl);
    } catch (error) {
      if (error instanceof HttpError) {
        json(res, error.status, {
          error: error.message,
          code: error.code,
          ...error.extra,
        });
      } else {
        if (!config.quiet) console.error("[flexivault] unhandled error", error);
        json(res, 500, { error: "Internal server error", code: "internal_error" });
      }
    } finally {
      if (!config.quiet) {
        const elapsed = Date.now() - started;
        console.log(`${req.method} ${parsedUrl.pathname} ${res.statusCode} ${elapsed}ms`);
      }
    }
  });

  return {
    server,
    db,
    config,
    close() {
      clearInterval(bucketCleanup);
      return new Promise((resolve) => {
        server.close(() => {
          db.close();
          resolve();
        });
      });
    },
  };
}
