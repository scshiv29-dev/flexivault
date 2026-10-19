const BASE64_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Encodes bytes as standard base64 without relying on btoa (Hermes-safe). */
export function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;

    output += BASE64_CHARS[first >> 2];
    output += BASE64_CHARS[((first & 0x03) << 4) | (second >> 4)];
    output +=
      index + 1 < bytes.length
        ? BASE64_CHARS[((second & 0x0f) << 2) | (third >> 6)]
        : "=";
    output += index + 2 < bytes.length ? BASE64_CHARS[third & 0x3f] : "=";
  }
  return output;
}

/** Decodes base64 (standard or url-safe) into bytes. */
export function base64ToBytes(value: string): Uint8Array {
  const cleaned = value
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .replace(/=+$/g, "");

  if (cleaned.length % 4 === 1) {
    throw new Error("Invalid base64 length");
  }

  const output: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of cleaned) {
    const index = BASE64_CHARS.indexOf(char);
    if (index === -1) throw new Error("Invalid base64 character");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      output.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Uint8Array.from(output);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  let output = "";
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes[index++];
    if (byte < 0x80) {
      output += String.fromCharCode(byte);
    } else if ((byte & 0xe0) === 0xc0) {
      const second = bytes[index++] & 0x3f;
      output += String.fromCharCode(((byte & 0x1f) << 6) | second);
    } else if ((byte & 0xf0) === 0xe0) {
      const second = bytes[index++] & 0x3f;
      const third = bytes[index++] & 0x3f;
      output += String.fromCharCode(
        ((byte & 0x0f) << 12) | (second << 6) | third
      );
    } else if ((byte & 0xf8) === 0xf0) {
      const second = bytes[index++] & 0x3f;
      const third = bytes[index++] & 0x3f;
      const fourth = bytes[index++] & 0x3f;
      let codePoint =
        ((byte & 0x07) << 18) |
        (second << 12) |
        (third << 6) |
        fourth;
      codePoint -= 0x10000;
      output += String.fromCharCode(
        0xd800 + (codePoint >> 10),
        0xdc00 + (codePoint & 0x3ff)
      );
    } else {
      output += "\ufffd";
    }
  }

  return output;
}

export function utf8ToBytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);

    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = (codePoint - 0xd800) * 0x400 + (next - 0xdc00) + 0x10000;
        index += 1;
      }
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, value) => sum + value.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const value of arrays) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
