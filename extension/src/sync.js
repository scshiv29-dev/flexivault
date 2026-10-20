/* Conflict-aware push for extension-originated saves. */

import { api, ApiError } from "./api.js";
import { mergeItems } from "./store.js";

/**
 * Pushes the encrypted cache rows with the revision they were based on. If the
 * vault changed elsewhere, merge by row `updatedAt` and retry instead of
 * overwriting the other device.
 */
export async function pushDirtyCache({ config, session, cache, attempts = 3 }) {
  if (!config?.serverUrl || !session?.token) {
    throw new Error("Connect and unlock the vault to sync this login.");
  }

  let next = {
    ...cache,
    items: Array.isArray(cache?.items) ? cache.items : [],
    revision: Number(cache?.revision ?? 0),
    dirty: true,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await api.putVault(config.serverUrl, session.token, {
        baseRevision: next.revision,
        items: next.items,
      });
      return {
        pushed: true,
        cache: {
          ...next,
          revision: Number(result.revision ?? next.revision),
          lastSyncedAt: Date.now(),
          dirty: false,
        },
      };
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "revision_mismatch" &&
        Array.isArray(error.data?.items)
      ) {
        next = {
          ...next,
          items: mergeItems(next.items, error.data.items),
          revision: Number(error.data.revision ?? next.revision),
          dirty: true,
        };
        continue;
      }
      throw error;
    }
  }

  throw new Error("The vault kept changing. Try saving again.");
}
