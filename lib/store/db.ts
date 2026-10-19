import * as SQLite from "expo-sqlite";

import {
  LegacyTotpEntry,
  StoredVaultItem,
} from "@/lib/vault/types";

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const db = await SQLite.openDatabaseAsync("flexivault.db");
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;

        CREATE TABLE IF NOT EXISTS vault_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vault_items (
          id TEXT PRIMARY KEY NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_vault_items_updated
          ON vault_items(updated_at DESC);
      `);
      return db;
    })();
  }
  return databasePromise;
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM vault_meta WHERE key = ?",
    key
  );
  return row?.value ?? null;
}

export async function getAllMeta(): Promise<Record<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    "SELECT key, value FROM vault_meta"
  );
  const output: Record<string, string> = {};
  for (const row of rows) output[row.key] = row.value;
  return output;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    "INSERT INTO vault_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value
  );
}

export async function setManyMeta(values: Record<string, string>): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(values)) {
      await db.runAsync(
        "INSERT INTO vault_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        key,
        value
      );
    }
  });
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM vault_meta WHERE key = ?", key);
}

export async function getStoredItems(): Promise<StoredVaultItem[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: string;
    data: string;
    updated_at: number;
  }>("SELECT id, data, updated_at FROM vault_items ORDER BY updated_at DESC");
  return rows.map((row) => ({
    id: row.id,
    data: row.data,
    updatedAt: row.updated_at,
  }));
}

export async function saveStoredItems(items: StoredVaultItem[]): Promise<void> {
  if (items.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const item of items) {
      await db.runAsync(
        `INSERT INTO vault_items (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
        item.id,
        item.data,
        item.updatedAt
      );
    }
  });
}

export async function saveStoredItem(item: StoredVaultItem): Promise<void> {
  await saveStoredItems([item]);
}

export async function replaceAllStoredItems(
  items: StoredVaultItem[]
): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM vault_items");
    for (const item of items) {
      await db.runAsync(
        "INSERT INTO vault_items (id, data, updated_at) VALUES (?, ?, ?)",
        item.id,
        item.data,
        item.updatedAt
      );
    }
  });
}

export async function removeStoredItem(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync("DELETE FROM vault_items WHERE id = ?", id);
}

export async function wipeDatabase(): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync("DELETE FROM vault_items");
    await db.runAsync("DELETE FROM vault_meta");
  });
}

/**
 * Reads TOTP entries created by the pre-vault version of the app. The old
 * schema stored secrets as JSON-encoded byte arrays in a `verifydb` table.
 */
export async function readLegacyEntries(): Promise<LegacyTotpEntry[]> {
  try {
    const legacy = await SQLite.openDatabaseAsync("flexiauth");
    const table = await legacy.getFirstAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'verifydb'"
    );
    if (!table) {
      await legacy.closeAsync();
      return [];
    }
    const rows = await legacy.getAllAsync<LegacyTotpEntry>(
      "SELECT id, digits, issuer, label, period, secret FROM verifydb"
    );
    await legacy.closeAsync();
    return rows;
  } catch {
    return [];
  }
}
