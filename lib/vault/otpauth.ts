import { base64ToBytes, bytesToUtf8 } from "./base64";
import { base32Decode, base32Encode, isValidBase32, normaliseBase32 } from "./otp";
import { TotpAlgorithm, TotpConfig } from "./types";

export interface ParsedOtpAuth {
  type: "totp";
  issuer: string;
  label: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

function parseQuery(query: string): Record<string, string> {
  const output: Record<string, string> = {};
  if (!query) return output;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const separator = pair.indexOf("=");
    const rawKey = separator === -1 ? pair : pair.slice(0, separator);
    const rawValue = separator === -1 ? "" : pair.slice(separator + 1);
    const key = decodeURIComponent(rawKey.replace(/\+/g, " "));
    const value = decodeURIComponent(rawValue.replace(/\+/g, " "));
    output[key.toLowerCase()] = value;
  }
  return output;
}

function parseAlgorithm(value?: string): TotpAlgorithm {
  const upper = String(value ?? "SHA1").toUpperCase().replace("-", "");
  if (upper === "SHA256" || upper === "SHA512") return upper;
  return "SHA1";
}

function parseDigits(value?: string): number {
  const digits = Number.parseInt(value ?? "6", 10);
  return digits >= 6 && digits <= 8 ? digits : 6;
}

function parsePeriod(value?: string): number {
  const period = Number.parseInt(value ?? "30", 10);
  return period >= 10 && period <= 300 ? period : 30;
}

/**
 * Parses `otpauth://totp/...` URLs. Tolerant of unencoded colons, padded
 * secrets, lowercase base32 and issuer parameters in either location.
 */
export function parseOtpAuthUrl(url: string): ParsedOtpAuth {
  const trimmed = String(url ?? "").trim();
  const match = /^otpauth:\/\/(totp|hotp)\/([^?#]*)(?:\?(.*))?$/i.exec(trimmed);
  if (!match) throw new Error("Not an otpauth URL");
  if (match[1].toLowerCase() !== "totp") {
    throw new Error("Only time-based (TOTP) authenticators are supported");
  }

  const rawLabel = decodeURIComponent(match[2] ?? "").replace(/\+/g, " ");
  const params = parseQuery(match[3] ?? "");
  const secret = normaliseBase32(params.secret ?? "");

  if (!secret) throw new Error("This QR code does not include a secret");
  if (!isValidBase32(secret)) throw new Error("The secret is not valid base32");
  base32Decode(secret);

  const labelParts = rawLabel.split(":");
  const paramIssuer = params.issuer?.trim();
  const issuer =
    (labelParts.length > 1 ? labelParts[0].trim() : paramIssuer) || paramIssuer || "";
  const label =
    (labelParts.length > 1 ? labelParts.slice(1).join(":").trim() : rawLabel.trim()) ||
    issuer ||
    "Authenticator";

  return {
    type: "totp",
    issuer,
    label,
    secret,
    algorithm: parseAlgorithm(params.algorithm),
    digits: parseDigits(params.digits),
    period: parsePeriod(params.period),
  };
}

export function isOtpAuthUrl(value: string): boolean {
  return /^otpauth:\/\//i.test(String(value ?? "").trim());
}

export function isMigrationUrl(value: string): boolean {
  return /^otpauth-migration:\/\//i.test(String(value ?? "").trim());
}

export function otpToTotpConfig(parsed: ParsedOtpAuth): TotpConfig {
  return {
    secret: parsed.secret,
    algorithm: parsed.algorithm,
    digits: parsed.digits,
    period: parsed.period,
    issuer: parsed.issuer,
    label: parsed.label,
  };
}

/* ------------------------------------------------------------------ */
/* Google Authenticator migration payload (protobuf)                   */
/* ------------------------------------------------------------------ */

interface ProtoField {
  field: number;
  wire: number;
  value: number | Uint8Array;
}

function readVarint(bytes: Uint8Array, start: number): [number, number] {
  let value = 0;
  let shift = 0;
  let position = start;
  while (position < bytes.length) {
    const byte = bytes[position];
    position += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return [value, position];
    shift += 7;
    if (shift > 49) throw new Error("Invalid protobuf varint");
  }
  throw new Error("Unexpected end of protobuf data");
}

function parseProto(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let position = 0;

  while (position < bytes.length) {
    const keyResult = readVarint(bytes, position);
    const key = keyResult[0];
    position = keyResult[1];
    const field = Math.floor(key / 8);
    const wire = key & 7;

    if (wire === 0) {
      const valueResult = readVarint(bytes, position);
      fields.push({ field, wire, value: valueResult[0] });
      position = valueResult[1];
    } else if (wire === 2) {
      const lengthResult = readVarint(bytes, position);
      const length = lengthResult[0];
      position = lengthResult[1];
      if (position + length > bytes.length) throw new Error("Invalid protobuf payload");
      fields.push({ field, wire, value: bytes.slice(position, position + length) });
      position += length;
    } else if (wire === 1) {
      position += 8;
    } else if (wire === 5) {
      position += 4;
    } else {
      throw new Error("Unsupported protobuf wire type");
    }
  }

  return fields;
}

function firstString(fields: ProtoField[], field: number): string {
  const entry = fields.find((value) => value.field === field && value.wire === 2);
  if (!entry || !(entry.value instanceof Uint8Array)) return "";
  return bytesToUtf8(entry.value);
}

function firstNumber(fields: ProtoField[], field: number): number {
  const entry = fields.find((value) => value.field === field && value.wire === 0);
  return typeof entry?.value === "number" ? entry.value : 0;
}

function firstBytes(fields: ProtoField[], field: number): Uint8Array | null {
  const entry = fields.find((value) => value.field === field && value.wire === 2);
  return entry && entry.value instanceof Uint8Array ? entry.value : null;
}

/**
 * Parses `otpauth-migration://offline?data=...` export URLs produced by Google
 * Authenticator. Returns every TOTP entry found in the payload.
 */
export function parseMigrationUrl(url: string): ParsedOtpAuth[] {
  const dataMatch = /[?&]data=([^&]+)/.exec(url);
  if (!dataMatch) throw new Error("Migration QR code is missing its data payload");

  let decoded: string;
  try {
    decoded = decodeURIComponent(dataMatch[1]);
  } catch {
    decoded = dataMatch[1];
  }

  const payload = base64ToBytes(decoded.replace(/ /g, "+"));
  const root = parseProto(payload);
  const entries = root.filter((field) => field.field === 1 && field.wire === 2);
  const output: ParsedOtpAuth[] = [];

  for (const entry of entries) {
    if (!(entry.value instanceof Uint8Array)) continue;
    const parameters = parseProto(entry.value);
    const secretBytes = firstBytes(parameters, 1);
    if (!secretBytes || secretBytes.length === 0) continue;

    const otpType = firstNumber(parameters, 6);
    if (otpType === 1) continue; // HOTP counters cannot be migrated safely.

    const rawName = firstString(parameters, 2);
    const issuer = firstString(parameters, 3);
    const nameParts = rawName.split(":");
    const label =
      nameParts.length > 1 ? nameParts.slice(1).join(":").trim() : rawName.trim();

    const algorithmValue = firstNumber(parameters, 4);
    const algorithm: TotpAlgorithm =
      algorithmValue === 2 ? "SHA256" : algorithmValue === 3 ? "SHA512" : "SHA1";
    const digitsValue = firstNumber(parameters, 5);
    const digits = digitsValue === 2 ? 8 : 6;

    output.push({
      type: "totp",
      issuer: issuer || nameParts[0] || "",
      label: label || issuer || "Authenticator",
      secret: base32Encode(secretBytes),
      algorithm,
      digits,
      period: 30,
    });
  }

  return output;
}
