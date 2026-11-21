import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function list(value) {
  if (Array.isArray(value)) return value.map(String).map((v) => v.trim()).filter(Boolean);
  return String(value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function int(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(
    overrides.dataDir ?? process.env.DATA_DIR ?? path.join(here, "..", "data")
  );

  return {
    host: overrides.host ?? process.env.HOST ?? "0.0.0.0",
    port: int(overrides.port ?? process.env.PORT, 8787),
    dataDir,
    serverName: overrides.serverName ?? process.env.SERVER_NAME ?? "FlexiVault",
    registrationOpen:
      overrides.registrationOpen ?? bool(process.env.REGISTRATION_OPEN, true),
    // Comma-separated codes that let someone register while REGISTRATION_OPEN
    // is false, so the owner can add family members without opening sign-up.
    inviteCodes: list(overrides.inviteCodes ?? process.env.INVITE_CODES),
    // Public address shown on the connect page and in its QR code. Derived
    // from the request when unset.
    publicUrl: (overrides.publicUrl ?? process.env.PUBLIC_URL ?? "").trim().replace(/\/+$/, ""),
    connectPage: overrides.connectPage ?? bool(process.env.CONNECT_PAGE, true),
    corsOrigins:
      overrides.corsOrigins ??
      (process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)
        : ["*"]),
    jwtSecret: overrides.jwtSecret ?? process.env.JWT_SECRET ?? null,
    encryptionSecret: overrides.encryptionSecret ?? process.env.ENCRYPTION_SECRET ?? null,
    tokenTtlSeconds: int(process.env.TOKEN_TTL_SECONDS, 60 * 60 * 24 * 30),
    maxVaultBytes: int(process.env.MAX_VAULT_BYTES, 8 * 1024 * 1024),
    maxItems: int(process.env.MAX_ITEMS, 5000),
    trustProxy: overrides.trustProxy ?? bool(process.env.TRUST_PROXY, false),
    quiet: overrides.quiet ?? bool(process.env.QUIET, false),
  };
}
