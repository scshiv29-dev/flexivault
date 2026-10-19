import { hmac } from "@noble/hashes/hmac";
import { sha1 } from "@noble/hashes/sha1";
import { sha256 } from "@noble/hashes/sha256";
import { sha512 } from "@noble/hashes/sha512";

import { TotpAlgorithm, TotpConfig } from "./types";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const HASHERS = {
  SHA1: sha1,
  SHA256: sha256,
  SHA512: sha512,
} as const;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function normaliseBase32(secret: string): string {
  return String(secret).toUpperCase().replace(/[\s=-]/g, "");
}

export function base32Decode(secret: string): Uint8Array {
  const clean = normaliseBase32(secret);
  if (!clean) throw new Error("TOTP secret is empty");

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("TOTP secret is not valid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(output);
}

export function isValidBase32(secret: string): boolean {
  const clean = normaliseBase32(secret);
  return clean.length >= 8 && /^[A-Z2-7]+$/.test(clean);
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let value = Math.floor(counter);
  for (let index = 7; index >= 0; index -= 1) {
    bytes[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
  return bytes;
}

export function generateHotp(
  secret: string,
  counter: number,
  algorithm: TotpAlgorithm = "SHA1",
  digits = 6
): string {
  const key = base32Decode(secret);
  const hash = hmac(HASHERS[algorithm] ?? sha1, key, counterBytes(counter));
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);
  const code = binary % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export function generateTotp(
  config: Pick<TotpConfig, "secret" | "algorithm" | "digits" | "period">,
  timestamp: number = Date.now()
): string {
  const period = config.period > 0 ? config.period : 30;
  const digits = config.digits >= 6 && config.digits <= 8 ? config.digits : 6;
  const counter = Math.floor(timestamp / 1000 / period);
  return generateHotp(config.secret, counter, config.algorithm ?? "SHA1", digits);
}

export function secondsRemaining(
  period: number = 30,
  timestamp: number = Date.now()
): number {
  const safePeriod = period > 0 ? period : 30;
  return safePeriod - (Math.floor(timestamp / 1000) % safePeriod);
}

export function totpProgress(
  period: number = 30,
  timestamp: number = Date.now()
): number {
  return secondsRemaining(period, timestamp) / (period > 0 ? period : 30);
}

export function formatTotpCode(code: string, groupSize = 3): string {
  if (!code) return "";
  const groups = code.match(new RegExp(`.{1,${groupSize}}`, "g"));
  return groups ? groups.join(" ") : code;
}

/** Parses the legacy `[12,34,...]` secret format used by the old app. */
export function legacySecretToBase32(secret: string): string {
  try {
    const parsed = JSON.parse(secret);
    if (Array.isArray(parsed)) return base32Encode(Uint8Array.from(parsed));
  } catch {
    // Fall through — the value may already be base32.
  }
  return normaliseBase32(secret);
}
