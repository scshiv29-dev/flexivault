import { isValidBase32, normaliseBase32 } from "./otp";
import { isOtpAuthUrl, otpToTotpConfig, parseOtpAuthUrl } from "./otpauth";
import type {
  TotpAlgorithm,
  TotpConfig,
  VaultItem,
  VaultItemType,
} from "./types";

/**
 * A vault item without the fields the store owns. Kept here rather than
 * importing from the state layer so this parser stays usable from tests and
 * from the browser extension.
 */
export type ImportedVaultItem = Omit<
  VaultItem,
  "id" | "createdAt" | "updatedAt" | "deletedAt"
>;

export type ImportFormat =
  | "bitwarden-csv"
  | "1password-csv"
  | "chrome-csv"
  | "lastpass-csv"
  | "protonpass-csv"
  | "dashlane-csv"
  | "keepass-csv"
  | "generic-csv"
  | "bitwarden-json"
  | "generic-json";

export interface ImportPreview {
  format: ImportFormat;
  drafts: ImportedVaultItem[];
  warnings: string[];
  skipped: number;
  totalRows: number;
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

type Row = Record<string, string>;

const FIELD_ALIASES: Record<string, string[]> = {
  name: ["name", "title", "item_name", "itemname", "entry_name"],
  username: [
    "username",
    "user",
    "login",
    "login_username",
    "loginname",
    "email",
    "username1",
    "username2",
    "username3",
  ],
  password: ["password", "pass", "login_password", "password1"],
  url: [
    "url",
    "uri",
    "login_uri",
    "login_url",
    "website",
    "web_site",
    "site_url",
    "urls",
  ],
  notes: ["notes", "note", "comments", "comment", "extra", "description"],
  folder: ["folder", "group", "grouping", "collection", "category", "vault", "tags"],
  favorite: ["favorite", "fav", "starred"],
  type: ["type", "item_type", "itemtype", "kind"],
  totp: [
    "totp",
    "otp",
    "otpauth",
    "login_totp",
    "otpsecret",
    "otp_secret",
    "one_time_password",
    "onetimepassword",
  ],
  cardNumber: ["card_number", "cardnumber", "number", "card_num"],
  cardHolder: [
    "card_holder",
    "cardholder",
    "cardholdername",
    "card_holder_name",
    "holder",
    "name_on_card",
  ],
  cardExpiry: [
    "expiry",
    "expiration",
    "expirydate",
    "expiry_date",
    "expiration_date",
    "exp_month",
  ],
  cardCvv: ["cvv", "cvc", "security_code", "securitycode", "code"],
  cardBrand: ["brand", "card_brand", "cardtype", "card_type"],
  fullName: ["full_name", "fullname", "identity_name", "legal_name"],
  phone: ["phone", "phone_number", "phonenumber"],
  address: ["address", "street_address"],
  company: ["company", "organization", "organisation"],
  passport: ["passport", "passport_number", "passportnumber"],
};

function normaliseKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\ufeff/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function findValue(row: Row, field: string): string {
  for (const alias of FIELD_ALIASES[field] ?? [field]) {
    const value = row[normaliseKey(alias)];
    if (value != null && String(value).trim() !== "") return String(value).trim();
  }
  return "";
}

function splitUrls(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseBoolean(value: string): boolean {
  return /^(1|true|yes|y|favorite|starred)$/i.test(value.trim());
}

function parseDelimited(text: string, forcedDelimiter?: string): ParsedTable {
  let source = text.replace(/^\ufeff/, "");
  const lines = source.split(/\r?\n/);

  let delimiter = forcedDelimiter;
  if (!delimiter) {
    if (/^sep=./i.test(lines[0] ?? "")) {
      delimiter = lines[0].slice(4, 5);
      source = source.slice(source.indexOf("\n") + 1);
    } else {
      const sample = lines.find((line) => line.trim().length > 0) ?? "";
      const candidates = [",", ";", "\t"];
      delimiter = candidates
        .map((candidate) => ({
          candidate,
          count: countOutsideQuotes(sample, candidate),
        }))
        .sort((left, right) => right.count - left.count)[0].candidate;
    }
  }

  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.some((value) => value.trim().length > 0)) records.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      pushRow();
    } else if (char !== "\r") {
      field += char;
    }
  }

  // The final row has no trailing newline in most exports.
  if (field.length > 0 || row.length > 0) pushRow();

  if (records.length === 0) return { headers: [], rows: [], delimiter };

  const headers = records[0].map((header) => normaliseKey(header));
  const rows = records.slice(1).map((record) => {
    const padded = [...record];
    while (padded.length < headers.length) padded.push("");
    return padded;
  });

  return { headers, rows, delimiter };
}

function countOutsideQuotes(value: string, needle: string): number {
  let count = 0;
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '"') {
      if (inQuotes && value[index + 1] === '"') {
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && char === needle) {
      count += 1;
    }
  }
  return count;
}

function rowFrom(headers: string[], record: string[]): Row {
  const row: Row = {};
  headers.forEach((header, index) => {
    row[header] = record[index] ?? "";
  });
  return row;
}

function detectCsvFormat(headers: string[]): ImportFormat {
  const keys = new Set(headers);
  if (keys.has("login_uri") || keys.has("login_password") || keys.has("folder")) {
    return "bitwarden-csv";
  }
  if (keys.has("otpauth") || keys.has("archived")) return "1password-csv";
  if (keys.has("grouping")) return "lastpass-csv";
  if (keys.has("otpsecret") || keys.has("category")) return "dashlane-csv";
  if (keys.has("group") && keys.has("title") && keys.has("url") && keys.has("notes")) {
    return "keepass-csv";
  }
  if (keys.has("name") && keys.has("url") && keys.has("username") && keys.has("password") && keys.has("note")) {
    return "chrome-csv";
  }
  return "generic-csv";
}

function asType(value: string): VaultItemType | null {
  const clean = value.trim().toLowerCase();
  if (!clean) return null;
  if (/^(1|login|password|credential|credentials)$/.test(clean)) return "login";
  if (/^(2|note|secure note|securenote)$/.test(clean)) return "note";
  if (/^(3|card|credit card|payment card)$/.test(clean)) return "card";
  if (/^(4|identity|id)$/.test(clean)) return "identity";
  if (/^(totp|authenticator|otp)$/.test(clean)) return "totp";
  return null;
}

function asAlgorithm(value: string): TotpAlgorithm {
  const clean = value.trim().toUpperCase().replace("-", "");
  return clean === "SHA256" || clean === "SHA512" ? clean : "SHA1";
}

function boundedNumber(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function totpFrom(row: Row, name: string, username: string): TotpConfig | null {
  const raw = findValue(row, "totp");
  if (!raw) return null;

  if (isOtpAuthUrl(raw)) {
    try {
      return otpToTotpConfig(parseOtpAuthUrl(raw));
    } catch {
      return null;
    }
  }

  const secret = normaliseBase32(raw);
  if (!secret || !isValidBase32(secret)) return null;
  return {
    secret,
    algorithm: asAlgorithm(row.algorithm ?? ""),
    digits: boundedNumber(row.digits ?? "", 6, 6, 8),
    period: boundedNumber(row.period ?? "", 30, 10, 300),
    issuer: name,
    label: username || name,
  };
}

function draftFromRow(row: Row, warnings: string[], index: number): ImportedVaultItem | null {
  const name = findValue(row, "name");
  const username = findValue(row, "username");
  const password = findValue(row, "password");
  const url = findValue(row, "url");
  const notes = findValue(row, "notes");
  const folder = findValue(row, "folder");
  const favorite = parseBoolean(findValue(row, "favorite"));
  const declaredType = asType(findValue(row, "type"));

  const cardNumber = findValue(row, "cardNumber");
  const cardHolder = findValue(row, "cardHolder");
  const cardExpiry = findValue(row, "cardExpiry");
  const cardCvv = findValue(row, "cardCvv");
  const cardBrand = findValue(row, "cardBrand");

  const effectiveType: VaultItemType | null =
    declaredType ??
    (cardNumber || cardHolder
      ? "card"
      : password || username || url
        ? "login"
        : notes
          ? "note"
          : null);

  if (!effectiveType) return null;

  const displayName =
    name ||
    (effectiveType === "card"
      ? cardBrand || cardHolder || "Imported card"
      : effectiveType === "note"
        ? notes.split("\n")[0]?.slice(0, 80) || `Imported note ${index + 1}`
        : username || url || `Imported login ${index + 1}`);

  const draft: ImportedVaultItem = {
    type: effectiveType,
    name: displayName,
    username: username || undefined,
    password: password || undefined,
    urls: splitUrls(url),
    notes,
    folder: folder || undefined,
    favorite,
  };

  if (effectiveType === "card") {
    draft.card = {
      number: cardNumber || undefined,
      holder: cardHolder || undefined,
      expiry: cardExpiry || undefined,
      cvv: cardCvv || undefined,
      brand: cardBrand || undefined,
    };
  }

  if (effectiveType === "identity") {
    draft.identity = {
      fullName: findValue(row, "fullName") || name || undefined,
      email: username || undefined,
      phone: findValue(row, "phone") || undefined,
      address: findValue(row, "address") || undefined,
      company: findValue(row, "company") || undefined,
      passport: findValue(row, "passport") || undefined,
    };
  }

  const totp = totpFrom(row, displayName, username);
  if (totp) draft.totp = totp;
  else if (findValue(row, "totp")) {
    warnings.push(`Row ${index + 2}: the authenticator secret for “${displayName}” is not valid and was skipped.`);
  }

  if (!draft.urls?.length && url) draft.urls = [url];
  return draft;
}

export function importCsv(text: string, forcedDelimiter?: string): ImportPreview {
  const table = parseDelimited(text, forcedDelimiter);
  if (table.headers.length === 0) {
    throw new Error("The file is empty or has no header row.");
  }

  let format = detectCsvFormat(table.headers);

  const warnings: string[] = [];
  const drafts: ImportedVaultItem[] = [];
  let skipped = 0;

  table.rows.forEach((record, index) => {
    const row = rowFrom(table.headers, record);
    try {
      const draft = draftFromRow(row, warnings, index);
      if (draft) drafts.push(draft);
      else skipped += 1;
    } catch (caught) {
      skipped += 1;
      warnings.push(`Row ${index + 2}: ${(caught as Error).message}`);
    }
  });

  return {
    format,
    drafts,
    warnings,
    skipped,
    totalRows: table.rows.length,
  };
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value);
}

function recordValue(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (value != null && String(value).trim() !== "") return stringValue(value).trim();
  }
  return "";
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function bitwardenJsonItem(
  item: Record<string, unknown>,
  folderNames: Map<string, string>,
  warnings: string[],
  index: number
): ImportedVaultItem | null {
  const type = Number(item.type ?? 1);
  const name = stringValue(item.name).trim();
  const notes = stringValue(item.notes).trim();
  const folderId = stringValue(item.folderId);
  const folder = folderNames.get(folderId) || stringValue(item.folder).trim();
  const favorite = Boolean(item.favorite);

  if (type === 2) {
    if (!name && !notes) return null;
    return {
      type: "note",
      name: name || notes.split("\n")[0]?.slice(0, 80) || `Imported note ${index + 1}`,
      notes,
      folder: folder || undefined,
      favorite,
      urls: [],
    };
  }

  if (type === 3) {
    const card = nestedRecord(item.card);
    return {
      type: "card",
      name: name || stringValue(card.brand) || "Imported card",
      notes,
      folder: folder || undefined,
      favorite,
      urls: [],
      card: {
        number: stringValue(card.number) || undefined,
        holder: stringValue(card.cardholderName) || undefined,
        expiry: [card.expMonth, card.expYear].filter(Boolean).join("/") || undefined,
        cvv: stringValue(card.code) || undefined,
        brand: stringValue(card.brand) || undefined,
      },
    };
  }

  if (type === 4) {
    const identity = nestedRecord(item.identity);
    return {
      type: "identity",
      name: name || stringValue(identity.fullName) || "Imported identity",
      notes,
      folder: folder || undefined,
      favorite,
      urls: [],
      identity: {
        fullName: stringValue(identity.fullName) || undefined,
        email: stringValue(identity.email) || undefined,
        phone: stringValue(identity.phone) || undefined,
        address: [identity.address1, identity.address2, identity.address3]
          .filter(Boolean)
          .join(", ") || undefined,
        company: stringValue(identity.company) || undefined,
        passport: stringValue(identity.passportNumber) || undefined,
      },
    };
  }

  const login = nestedRecord(item.login);
  const uris = Array.isArray(login.uris) ? login.uris : [];
  const urls = uris
    .map((entry) => stringValue(nestedRecord(entry).uri).trim())
    .filter(Boolean);
  const totpRaw = stringValue(login.totp).trim();
  let totp: TotpConfig | undefined;
  if (totpRaw) {
    const totpRow: Row = { totp: totpRaw };
    totp = totpFrom(totpRow, name || "Authenticator", stringValue(login.username)) ?? undefined;
    if (!totp) warnings.push(`Item ${index + 1}: the authenticator secret for “${name}” is not valid.`);
  }

  return {
    type: "login",
    name: name || stringValue(login.username) || "Imported login",
    username: stringValue(login.username) || undefined,
    password: stringValue(login.password) || undefined,
    urls,
    notes,
    folder: folder || undefined,
    favorite,
    totp,
  };
}

function genericJsonItem(item: Record<string, unknown>, index: number): ImportedVaultItem | null {
  const row: Row = {};
  for (const [key, value] of Object.entries(item)) {
    if (value == null || typeof value === "object") continue;
    row[normaliseKey(key)] = String(value);
  }

  // Common generic exports nest credentials under "login" or "fields".
  const login = nestedRecord(item.login);
  if (Object.keys(login).length > 0) {
    row.username = stringValue(login.username || login.user || row.username);
    row.password = stringValue(login.password || row.password);
    row.totp = stringValue(login.totp || row.totp);
    const uris = Array.isArray(login.uris) ? login.uris : [];
    const firstUri = uris
      .map((entry) => stringValue(nestedRecord(entry).uri))
      .find(Boolean);
    if (firstUri && !row.url) row.url = firstUri;
  }

  return draftFromRow(row, [], index);
}

export function importJson(text: string): ImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  const warnings: string[] = [];
  const drafts: ImportedVaultItem[] = [];
  let skipped = 0;
  let format: ImportFormat = "generic-json";

  const root = nestedRecord(parsed);
  const rawItems = Array.isArray(parsed)
    ? parsed
    : Array.isArray(root.items)
      ? root.items
      : null;

  if (!rawItems) {
    throw new Error("Expected a JSON array or a Bitwarden export with an “items” array.");
  }

  let folderNames = new Map<string, string>();
  if (Array.isArray(root.folders)) {
    format = "bitwarden-json";
    folderNames = new Map(
      root.folders
        .map((entry) => nestedRecord(entry))
        .filter((entry) => entry.id != null && entry.name != null)
        .map((entry) => [stringValue(entry.id), stringValue(entry.name)])
    );
  }

  rawItems.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      skipped += 1;
      return;
    }
    const record = entry as Record<string, unknown>;
    try {
      const draft =
        format === "bitwarden-json"
          ? bitwardenJsonItem(record, folderNames, warnings, index)
          : genericJsonItem(record, index);
      if (draft) drafts.push(draft);
      else skipped += 1;
    } catch (caught) {
      skipped += 1;
      warnings.push(`Item ${index + 1}: ${(caught as Error).message}`);
    }
  });

  return {
    format,
    drafts,
    warnings,
    skipped,
    totalRows: rawItems.length,
  };
}

export function importPasswords(filename: string, text: string): ImportPreview {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json") || text.trim().startsWith("[") || text.trim().startsWith("{")) {
    return importJson(text);
  }
  return importCsv(text);
}
