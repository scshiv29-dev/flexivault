import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
  "base64url"
);

export function b64url(input) {
  return Buffer.from(input).toString("base64url");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function loadSecret(explicit, dataDir, filename) {
  if (explicit) {
    // Accept either a raw string or base64; normalise to 32 bytes.
    const fromBase64 = Buffer.from(explicit, "base64");
    const raw = fromBase64.length >= 32 ? fromBase64 : Buffer.from(explicit, "utf8");
    return Buffer.from(raw.subarray(0, 32));
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, filename);
  if (fs.existsSync(file)) {
    return Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
  }

  const secret = randomBytes(32);
  fs.writeFileSync(file, secret.toString("base64"), { mode: 0o600 });
  return secret;
}

export function scryptHash(authHash, salt) {
  return scryptSync(authHash, salt, 64).toString("base64");
}

export function scryptVerify(authHash, salt, expected) {
  const actual = scryptSync(authHash, salt, 64);
  const expectedBuffer = Buffer.from(expected, "base64");
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export function signToken(payload, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  const data = `${JWT_HEADER}.${body}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function verifyToken(token, secret) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secret).update(data).digest("base64url");
  const actual = parts[2];
  if (actual.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function encryptString(plaintext, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${tag.toString(
    "base64url"
  )}`;
}

export function decryptString(payload, key) {
  const [version, ivB64, dataB64, tagB64] = String(payload).split(".");
  if (version !== "v1" || !ivB64 || !dataB64 || !tagB64) {
    throw new Error("Invalid encrypted payload");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function safeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}
