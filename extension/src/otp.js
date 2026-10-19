/* RFC 6238 TOTP using WebCrypto — mirrors lib/vault/otp.ts. */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function normaliseBase32(secret) {
  return String(secret ?? "")
    .toUpperCase()
    .replace(/[\s=-]/g, "");
}

export function base32Decode(secret) {
  const clean = normaliseBase32(secret);
  if (!clean) throw new Error("This authenticator has no secret.");

  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("The secret is not valid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function isValidBase32(secret) {
  const clean = normaliseBase32(secret);
  return clean.length >= 8 && /^[A-Z2-7]+$/.test(clean);
}

function counterBytes(counter) {
  const bytes = new Uint8Array(8);
  let value = Math.floor(counter);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

const HASHES = {
  SHA1: "SHA-1",
  SHA256: "SHA-256",
  SHA512: "SHA-512",
};

export async function generateTotp(config, timestamp = Date.now()) {
  const period = config.period > 0 ? config.period : 30;
  const digits =
    config.digits >= 6 && config.digits <= 8 ? config.digits : 6;
  const counter = Math.floor(timestamp / 1000 / period);
  const keyBytes = base32Decode(config.secret);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: HASHES[config.algorithm] ?? "SHA-1" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, counterBytes(counter))
  );

  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const code = binary % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export function secondsRemaining(period = 30, timestamp = Date.now()) {
  const safe = period > 0 ? period : 30;
  return safe - (Math.floor(timestamp / 1000) % safe);
}

export function totpProgress(period = 30, timestamp = Date.now()) {
  const safe = period > 0 ? period : 30;
  return secondsRemaining(safe, timestamp) / safe;
}

export function formatTotpCode(code, groupSize = 3) {
  if (!code) return "";
  const groups = code.match(new RegExp(`.{1,${groupSize}}`, "g"));
  return groups ? groups.join(" ") : code;
}
