import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Opens (and migrates) the SQLite database used by the sync server.
 *
 * The server only ever stores opaque client-encrypted vault payloads. Account
 * metadata (email, kdf parameters, auth verifier, 2FA state) lives here too.
 */
export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "flexivault.sqlite"));

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      auth_verifier TEXT NOT NULL,
      auth_salt TEXT NOT NULL,
      kdf_salt TEXT NOT NULL,
      kdf_iterations INTEGER NOT NULL,
      totp_secret TEXT,
      totp_pending TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vault_items (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, item_id)
    );

    -- The composite primary key already indexes user_id as its left-most
    -- column, so a separate user_id index only adds write cost.
    DROP INDEX IF EXISTS idx_vault_items_user;

    CREATE TABLE IF NOT EXISTS server_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  return db;
}
