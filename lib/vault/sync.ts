import { ApiError, api } from "./api";
import { decryptItem, encryptItem } from "./crypto";
import { StoredVaultItem, SyncResult, VaultItem } from "./types";

export class VaultDecryptError extends Error {
  constructor(message = "This vault was encrypted with a different master password") {
    super(message);
    this.name = "VaultDecryptError";
  }
}

export function mergeItems(local: VaultItem[], remote: VaultItem[]): VaultItem[] {
  const byId = new Map<string, VaultItem>();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    if (!existing || item.updatedAt > existing.updatedAt) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function decryptRemoteItems(
  encryptionKey: Uint8Array,
  rows: StoredVaultItem[]
): VaultItem[] {
  return rows.map((row) => {
    try {
      return decryptItem<VaultItem>(encryptionKey, row.data);
    } catch {
      throw new VaultDecryptError();
    }
  });
}

interface SyncInput {
  serverUrl: string;
  token: string;
  encryptionKey: Uint8Array;
  revision: number;
  items: VaultItem[];
  dirty: boolean;
}

/**
 * Two-way sync with last-write-wins conflict handling.
 *
 * The server stores one opaque ciphertext per item and a monotonically
 * increasing vault revision. When another device has written since our last
 * sync, we pull, merge by item `updatedAt`, and retry the push.
 */
export async function syncVault(input: SyncInput): Promise<SyncResult> {
  const remote = await api.getVault(input.serverUrl, input.token);
  let remoteItems = decryptRemoteItems(input.encryptionKey, remote.items);

  if (!input.dirty && remote.revision >= input.revision) {
    return {
      items: remoteItems,
      revision: remote.revision,
      pushed: false,
    };
  }

  let merged = mergeItems(input.items, remoteItems);
  let baseRevision = remote.revision;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const encrypted = merged.map((item) => ({
      id: item.id,
      data: encryptItem(input.encryptionKey, item),
      updatedAt: item.updatedAt,
    }));

    try {
      const response = await api.putVault(input.serverUrl, input.token, {
        baseRevision,
        items: encrypted,
      });
      return {
        items: merged,
        revision: response.revision,
        pushed: true,
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "revision_mismatch" &&
        Array.isArray(error.data.items)
      ) {
        const conflictRows = error.data.items as StoredVaultItem[];
        remoteItems = decryptRemoteItems(input.encryptionKey, conflictRows);
        merged = mergeItems(merged, remoteItems);
        baseRevision = Number(error.data.revision ?? baseRevision);
        continue;
      }
      throw error;
    }
  }

  throw new ApiError(
    "Could not sync because the vault kept changing. Try again.",
    409,
    "sync_conflict"
  );
}
