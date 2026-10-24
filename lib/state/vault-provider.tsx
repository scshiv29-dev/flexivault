import * as LocalAuthentication from "expo-local-authentication";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";

import {
  clearAllPendingAutofillSaves,
  clearAutofillCache,
  clearPendingAutofillSaves,
  configureAutofill,
  hasNativeAutofill,
  lockAutofill,
  readPendingAutofillSaves,
} from "@/lib/native/autofill";
import {
  clearNativePasskeys,
  clearPendingPasskeys,
  hasNativePasskeys,
  readPendingPasskeys,
  syncNativePasskeys,
} from "@/lib/native/passkeys";
import {
  getAllMeta,
  getStoredItems,
  readLegacyEntries,
  replaceAllStoredItems,
  saveStoredItem,
  saveStoredItems,
  setManyMeta,
  setMeta,
  wipeDatabase,
} from "@/lib/store/db";
import {
  getBiometricKey,
  getSessionToken,
  setBiometricKey,
  setSessionToken,
} from "@/lib/store/session";
import {
  ApiError,
  api,
  normalizeServerUrl,
  type AuthResponse,
  type PreloginResponse,
} from "@/lib/vault/api";
import { base64ToBytes, bytesToBase64 } from "@/lib/vault/base64";
import {
  createKdfSalt,
  decryptItem,
  deriveKeys,
  encryptItem,
  keyCheck,
  newItemId,
} from "@/lib/vault/crypto";
import { mergeItems, syncVault } from "@/lib/vault/sync";
import { mergePendingAutofillSave } from "@/lib/vault/autofill-save";
import { mergePendingPasskey } from "@/lib/vault/passkeys";
import {
  DEFAULT_AUTO_LOCK_MINUTES,
  KDF_ITERATIONS,
  type LegacyTotpEntry,
  type ServerProfile,
  type ServerSession,
  type StoredVaultItem,
  type SyncStatus,
  type ThemeMode,
  type VaultItem,
  type VaultSettings,
} from "@/lib/vault/types";
import {
  META,
  VaultError,
  legacyItemsFrom,
  sortItems,
  type ConnectServerInput,
  type ConnectServerResult,
  type NewVaultItem,
} from "./vault-helpers";

export type VaultStatus = "loading" | "onboarding" | "locked" | "unlocked";

const DEFAULT_SETTINGS: VaultSettings = {
  autoLockMinutes: DEFAULT_AUTO_LOCK_MINUTES,
  biometricsEnabled: false,
  autofillEnabled: false,
  themeMode: "system",
};

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError || error instanceof VaultError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function decryptRows(
  rows: StoredVaultItem[],
  encryptionKey: Uint8Array
): VaultItem[] {
  return rows.map((row) => {
    try {
      return decryptItem<VaultItem>(encryptionKey, row.data);
    } catch {
      throw new VaultError(
        "key_mismatch",
        "This vault was encrypted with a different master password."
      );
    }
  });
}

function toStoredItems(
  items: VaultItem[],
  encryptionKey: Uint8Array
): StoredVaultItem[] {
  return items.map((item) => ({
    id: item.id,
    data: encryptItem(encryptionKey, item),
    updatedAt: item.updatedAt,
  }));
}

function profileFromAuth(auth: AuthResponse): ServerProfile {
  return {
    email: auth.email,
    kdfSalt: auth.kdfSalt,
    kdfIterations: auth.kdfIterations,
    totpEnabled: auth.totpEnabled,
    revision: auth.revision,
    createdAt: auth.createdAt,
  };
}

export interface VaultContextValue {
  status: VaultStatus;
  items: VaultItem[];
  settings: VaultSettings;
  session: ServerSession | null;
  serverProfile: ServerProfile | null;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSyncedAt: number | null;
  legacyCount: number;
  biometricAvailable: boolean;

  createVault: (password: string) => Promise<void>;
  unlock: (password: string) => Promise<void>;
  unlockWithBiometrics: () => Promise<void>;
  lock: () => void;

  addItem: (draft: NewVaultItem) => Promise<VaultItem>;
  updateItem: (item: VaultItem) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  importItems: (drafts: NewVaultItem[]) => Promise<void>;
  renameGroup: (from: string, to: string) => Promise<void>;
  deleteGroup: (name: string) => Promise<void>;

  connectServer: (input: ConnectServerInput) => Promise<ConnectServerResult>;
  disconnectServer: () => Promise<void>;
  syncNow: () => Promise<void>;
  refreshServerProfile: () => Promise<ServerProfile>;
  setupServerTotp: () => Promise<{ secret: string; otpauthUrl: string }>;
  enableServerTotp: (code: string) => Promise<void>;
  disableServerTotp: (code: string) => Promise<void>;

  setAutoLockMinutes: (value: number) => Promise<void>;
  setThemeMode: (value: ThemeMode) => Promise<void>;
  setAutofillEnabled: (value: boolean) => Promise<void>;
  enableBiometrics: (password: string) => Promise<void>;
  disableBiometrics: () => Promise<void>;

  exportBackup: () => Promise<string>;
  resetVault: () => Promise<void>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) throw new Error("useVault must be used inside <VaultProvider>");
  return value;
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus>("loading");
  const [items, setItems] = useState<VaultItem[]>([]);
  const [settings, setSettings] = useState<VaultSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [session, setSession] = useState<ServerSession | null>(null);
  const [serverProfile, setServerProfile] = useState<ServerProfile | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [legacyCount, setLegacyCount] = useState(0);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const keyRef = useRef<Uint8Array | null>(null);
  const itemsRef = useRef<VaultItem[]>([]);
  const sessionRef = useRef<ServerSession | null>(null);
  const dirtyRef = useRef(false);
  const mutationRef = useRef(0);
  const statusRef = useRef<VaultStatus>("loading");
  const settingsRef = useRef<VaultSettings>(DEFAULT_SETTINGS);
  const legacyRef = useRef<LegacyTotpEntry[]>([]);
  const backgroundAtRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncNowRef = useRef<() => Promise<void>>(async () => {});
  const pendingImportRef = useRef(false);
  const importPendingAutofillRef = useRef<() => Promise<void>>(async () => {});
  const pendingPasskeyImportRef = useRef(false);
  const importPendingPasskeysRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const commitItems = useCallback((next: VaultItem[]) => {
    const sorted = sortItems(next);
    itemsRef.current = sorted;
    setItems(sorted.filter((item) => !item.deletedAt));
  }, []);

  const persistItems = useCallback(
    async (list: VaultItem[], encryptionKey: Uint8Array) => {
      await replaceAllStoredItems(toStoredItems(list, encryptionKey));
    },
    []
  );

  const markDirty = useCallback(async () => {
    dirtyRef.current = true;
    mutationRef.current += 1;
    await setMeta(META.dirty, "1");
  }, []);

  const scheduleSync = useCallback(() => {
    if (!sessionRef.current?.token || !keyRef.current) return;
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncNowRef.current().catch(() => {
        // Errors surface through syncError state.
      });
    }, 1500);
  }, []);

  const syncNow = useCallback(async () => {
    const currentSession = sessionRef.current;
    const encryptionKey = keyRef.current;

    if (!currentSession?.token) {
      throw new VaultError("not_connected", "Connect a sync server first.");
    }
    if (!encryptionKey) {
      throw new VaultError("locked", "Unlock your vault to sync.");
    }
    if (syncInFlightRef.current) return syncInFlightRef.current;

    const token = currentSession.token;

    const run = async () => {
      setSyncStatus("syncing");
      setSyncError(null);

      const mutationAtStart = mutationRef.current;

      try {
        const result = await syncVault({
          serverUrl: currentSession.url,
          token,
          encryptionKey,
          revision: currentSession.revision,
          items: itemsRef.current,
          dirty: dirtyRef.current,
        });

        const mutatedDuringSync = mutationRef.current !== mutationAtStart;
        const merged = mutatedDuringSync
          ? mergeItems(result.items, itemsRef.current)
          : result.items;

        await persistItems(merged, encryptionKey);
        commitItems(merged);

        const active = sessionRef.current;
        if (active && active.token === currentSession.token) {
          const nextSession: ServerSession = {
            ...active,
            revision: result.revision,
          };
          sessionRef.current = nextSession;
          setSession(nextSession);

          await setManyMeta({
            [META.serverRevision]: String(result.revision),
            ...(mutatedDuringSync ? {} : { [META.dirty]: "0" }),
          });
        }

        if (!mutatedDuringSync) dirtyRef.current = false;

        const syncedAt = Date.now();
        setLastSyncedAt(syncedAt);
        await setMeta(META.lastSyncedAt, String(syncedAt));
        setSyncStatus("success");

        if (mutatedDuringSync) scheduleSync();
      } catch (error) {
        const message =
          error instanceof ApiError && error.code === "unauthorized"
            ? "Sync session expired. Reconnect your server in Settings."
            : errorMessage(error, "Sync failed. We will retry automatically.");
        setSyncError(message);
        setSyncStatus("error");
        throw error;
      }
    };

    const promise = run().finally(() => {
      syncInFlightRef.current = null;
    });
    syncInFlightRef.current = promise;
    return promise;
  }, [commitItems, persistItems, scheduleSync]);

  useEffect(() => {
    syncNowRef.current = syncNow;
  }, [syncNow]);

  const lock = useCallback(() => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    keyRef.current = null;
    itemsRef.current = [];
    setItems([]);
    setStatus("locked");
    statusRef.current = "locked";
    void lockAutofill().catch(() => {});
    setSyncStatus("idle");
    // Keep ciphertext, but hide suggestions. The form now offers a separate
    // master-password unlock overlay instead of requiring the main app.
  }, []);

  const legacyItems = useCallback(() => legacyItemsFrom(legacyRef.current), []);

  const afterUnlock = useCallback(() => {
    backgroundAtRef.current = 0;
    setStatus("unlocked");
    if (sessionRef.current?.token) {
      setTimeout(() => {
        syncNowRef.current().catch(() => {
          // Surface through syncError.
        });
      }, 700);
    }
  }, []);

  /* ------------------------------- init ------------------------------- */

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await lockAutofill().catch(() => {});
        const meta = await getAllMeta();
        const token = await getSessionToken();

        const autoLock = Number(
          meta[META.autoLockMinutes] ?? DEFAULT_AUTO_LOCK_MINUTES
        );
        const themeMode = (["system", "light", "dark"] as const).includes(
          meta[META.themeMode] as ThemeMode
        )
          ? (meta[META.themeMode] as ThemeMode)
          : "system";

        const initialSettings: VaultSettings = {
          autoLockMinutes: Number.isFinite(autoLock)
            ? autoLock
            : DEFAULT_AUTO_LOCK_MINUTES,
          biometricsEnabled: meta[META.biometricsEnabled] === "1",
          autofillEnabled: meta[META.autofillEnabled] === "1",
          themeMode,
        };
        settingsRef.current = initialSettings;
        if (cancelled) return;
        setSettings(initialSettings);
        setSettingsLoaded(true);

        if (meta[META.serverUrl] && meta[META.serverEmail] && token) {
          const initialSession: ServerSession = {
            url: meta[META.serverUrl],
            email: meta[META.serverEmail],
            token,
            revision: Number(meta[META.serverRevision] ?? 0) || 0,
            totpEnabled: meta[META.serverTotpEnabled] === "1",
          };
          sessionRef.current = initialSession;
          setSession(initialSession);
        }

        const syncedAt = Number(meta[META.lastSyncedAt] ?? 0);
        if (syncedAt > 0) setLastSyncedAt(syncedAt);

        if (!meta[META.kdfSalt]) {
          const legacy = await readLegacyEntries();
          if (cancelled) return;
          legacyRef.current = legacy;
          setLegacyCount(legacy.length);
          setStatus("onboarding");
        } else {
          setStatus("locked");
        }

        try {
          const hardware = await LocalAuthentication.hasHardwareAsync();
          const enrolled = await LocalAuthentication.isEnrolledAsync();
          if (!cancelled) setBiometricAvailable(hardware && enrolled);
        } catch {
          if (!cancelled) setBiometricAvailable(false);
        }
      } catch {
        if (!cancelled) setStatus("onboarding");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* --------------------------- auto lock ------------------------------ */

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        backgroundAtRef.current = Date.now();
        return;
      }
      if (next !== "active") return;

      // A save overlay can queue a credential while the app is backgrounded.
      // Import it as soon as the unlocked app is visible again.
      void importPendingAutofillRef.current();
      void importPendingPasskeysRef.current();

      const since = backgroundAtRef.current;
      backgroundAtRef.current = 0;
      if (!since || statusRef.current !== "unlocked") return;

      const minutes = settingsRef.current.autoLockMinutes;
      if (minutes > 0 && Date.now() - since >= minutes * 60_000) lock();
    });

    return () => subscription.remove();
  }, [lock]);

  /* --------------------------- system autofill ------------------------ */

  useEffect(() => {
    if (Platform.OS !== "android" || !hasNativeAutofill()) return;
    // Do not clear the cache before persisted settings have loaded. The initial
    // autofillEnabled value is false, so an early effect run would erase a
    // perfectly good cache on every app launch.
    if (!settingsLoaded) return;

    if (!settings.autofillEnabled) {
      clearAutofillCache().catch(() => {
        // The cache is already absent, or the native module was removed.
      });
      return;
    }

    // Locking, backgrounding, or restarting the app must not erase the cache.
    // The native service only reads it, and every fill still opens the
    // device-authentication activity. Rewrite it when the vault is unlocked.
    if (status !== "unlocked") return;

    // Bulk changes (import, group rename) arrive in one React update. Debounce
    // the native encryption so we write one cache instead of one per item.
    const timer = setTimeout(() => {
      if (!keyRef.current || statusRef.current !== "unlocked") return;
      configureAutofill(items).catch(() => {
        // Do not break unlock or editing if the native cache cannot be written.
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [status, items, settings.autofillEnabled, settingsLoaded]);

  /**
   * The save overlay runs in the autofill service process, which cannot open the
   * encrypted vault. It leaves a Keystore-encrypted queue; this imports it once
   * the vault key exists. Item IDs are generated by the native side, so a retry
   * after a crash updates the same row instead of creating a duplicate.
   */
  const importPendingAutofill = useCallback(async () => {
    if (Platform.OS !== "android" || !hasNativeAutofill()) return;
    const key = keyRef.current;
    if (!key || statusRef.current !== "unlocked" || pendingImportRef.current) return;

    pendingImportRef.current = true;
    try {
      const pending = await readPendingAutofillSaves();
      if (pending.length === 0) return;

      await markDirty();
      const next = [...itemsRef.current];
      const imported: string[] = [];

      for (const save of pending) {
        const index = next.findIndex((item) => item.id === save.itemId);
        const item = mergePendingAutofillSave(
          index >= 0 ? next[index] : undefined,
          save
        );
        await saveStoredItem({
          id: item.id,
          data: encryptItem(key, item),
          updatedAt: item.updatedAt,
        });
        if (index >= 0) next[index] = item;
        else next.unshift(item);
        imported.push(save.itemId);
      }

      commitItems(next);
      scheduleSync();
      await clearPendingAutofillSaves(imported);
    } catch {
      // Keep the queue for the next unlock/foreground. Already-written rows are
      // idempotent because their IDs are stable.
    } finally {
      pendingImportRef.current = false;
    }
  }, [commitItems, markDirty, scheduleSync]);

  useEffect(() => {
    importPendingAutofillRef.current = importPendingAutofill;
  }, [importPendingAutofill]);

  useEffect(() => {
    if (status !== "unlocked") return;
    void importPendingAutofill();
  }, [status, importPendingAutofill]);

  /**
   * Passkeys created by the Android 14 credential provider are queued in a
   * Keystore-encrypted store because the provider can run while the vault is
   * locked. Import them into the encrypted vault once the key exists, then ask
   * the native store to mirror the complete vault.
   */
  const importPendingPasskeys = useCallback(async () => {
    if (Platform.OS !== "android" || !hasNativePasskeys()) return;
    const key = keyRef.current;
    if (!key || statusRef.current !== "unlocked" || pendingPasskeyImportRef.current) {
      return;
    }

    pendingPasskeyImportRef.current = true;
    try {
      const pending = await readPendingPasskeys();
      if (pending.length === 0) return;

      await markDirty();
      const next = [...itemsRef.current];
      const imported: string[] = [];

      for (const passkey of pending) {
        const index = next.findIndex((item) => item.id === passkey.vaultItemId);
        const item = mergePendingPasskey(
          index >= 0 ? next[index] : undefined,
          passkey
        );
        await saveStoredItem({
          id: item.id,
          data: encryptItem(key, item),
          updatedAt: item.updatedAt,
        });
        if (index >= 0) next[index] = item;
        else next.unshift(item);
        imported.push(passkey.credentialId);
      }

      commitItems(next);
      scheduleSync();
      await clearPendingPasskeys(imported);
      await syncNativePasskeys(next).catch(() => {
        // The mirror effect below retries after the next vault update.
      });
    } catch {
      // Keep the queue for the next unlock or foreground. Stable vault item IDs
      // make a retry idempotent.
    } finally {
      pendingPasskeyImportRef.current = false;
    }
  }, [commitItems, markDirty, scheduleSync]);

  useEffect(() => {
    importPendingPasskeysRef.current = importPendingPasskeys;
  }, [importPendingPasskeys]);

  useEffect(() => {
    if (status !== "unlocked") return;
    void importPendingPasskeys();
  }, [status, importPendingPasskeys]);

  useEffect(() => {
    if (status !== "unlocked" || Platform.OS !== "android" || !hasNativePasskeys()) {
      return;
    }
    const timer = setTimeout(() => {
      // Read the ref instead of `items` so tombstoned passkeys, which are
      // filtered out of the rendered list, are forwarded for native deletion.
      syncNativePasskeys(itemsRef.current).catch(() => {
        // Keep the vault usable if the native mirror cannot be updated.
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [status, items]);

  /* ----------------------------- onboarding ---------------------------- */

  const createVault = useCallback(
    async (password: string) => {
      if (password.length < 10) {
        throw new VaultError(
          "weak_master_password",
          "Use at least 10 characters for your master password."
        );
      }

      const salt = createKdfSalt();
      const derived = await deriveKeys(password, salt, KDF_ITERATIONS);
      const initial = legacyItems();

      await setManyMeta({
        [META.kdfSalt]: salt,
        [META.kdfIterations]: String(KDF_ITERATIONS),
        [META.keyCheck]: keyCheck(derived.encryptionKey),
        [META.createdAt]: String(Date.now()),
        [META.legacyImported]: "1",
        [META.dirty]: "0",
      });

      await persistItems(initial, derived.encryptionKey);
      keyRef.current = derived.encryptionKey;
      dirtyRef.current = false;
      commitItems(initial);
      setStatus("unlocked");
    },
    [commitItems, legacyItems, persistItems]
  );

  const unlock = useCallback(
    async (password: string) => {
      const meta = await getAllMeta();
      const salt = meta[META.kdfSalt];
      if (!salt) throw new VaultError("no_vault", "No vault exists on this device.");

      const iterations = Number(meta[META.kdfIterations] ?? KDF_ITERATIONS);
      const derived = await deriveKeys(password, salt, iterations);

      const storedCheck = meta[META.keyCheck];
      if (storedCheck && keyCheck(derived.encryptionKey) !== storedCheck) {
        throw new VaultError("invalid_password", "That master password is incorrect.");
      }

      const rows = await getStoredItems();
      const decrypted = decryptRows(rows, derived.encryptionKey);

      keyRef.current = derived.encryptionKey;
      dirtyRef.current = meta[META.dirty] === "1";
      commitItems(decrypted);
      afterUnlock();
    },
    [afterUnlock, commitItems]
  );

  const unlockWithBiometrics = useCallback(async () => {
    if (Platform.OS === "web") {
      throw new VaultError(
        "biometric_unavailable",
        "Biometric unlock is available in the mobile app."
      );
    }

    const stored = await getBiometricKey();
    if (!stored) {
      throw new VaultError(
        "biometric_unavailable",
        "Biometric unlock is not set up on this device."
      );
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Unlock FlexiVault",
      cancelLabel: "Cancel",
      fallbackLabel: "Use master password",
      disableDeviceFallback: false,
    });

    if (!result.success) {
      throw new VaultError("biometric_cancelled", "Biometric unlock was cancelled.");
    }

    const key = base64ToBytes(stored);
    const meta = await getAllMeta();
    const storedCheck = meta[META.keyCheck];
    if (storedCheck && keyCheck(key) !== storedCheck) {
      throw new VaultError(
        "key_mismatch",
        "The saved biometric key no longer matches this vault."
      );
    }

    const rows = await getStoredItems();
    const decrypted = decryptRows(rows, key);

    keyRef.current = key;
    dirtyRef.current = meta[META.dirty] === "1";
    commitItems(decrypted);
    afterUnlock();
  }, [afterUnlock, commitItems]);

  /* ------------------------------ items ------------------------------- */

  const addItem = useCallback(
    async (draft: NewVaultItem) => {
      const key = keyRef.current;
      if (!key) throw new VaultError("locked", "Unlock your vault first.");

      const now = Date.now();
      const item: VaultItem = {
        ...draft,
        urls: draft.urls ?? [],
        favorite: Boolean(draft.favorite),
        id: newItemId(),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      await saveStoredItem({
        id: item.id,
        data: encryptItem(key, item),
        updatedAt: now,
      });

      commitItems([item, ...itemsRef.current]);
      await markDirty();
      scheduleSync();
      return item;
    },
    [commitItems, markDirty, scheduleSync]
  );

  const updateItem = useCallback(
    async (item: VaultItem) => {
      const key = keyRef.current;
      if (!key) throw new VaultError("locked", "Unlock your vault first.");

      const next: VaultItem = {
        ...item,
        urls: item.urls ?? [],
        updatedAt: Date.now(),
      };

      await saveStoredItem({
        id: next.id,
        data: encryptItem(key, next),
        updatedAt: next.updatedAt,
      });

      commitItems(
        itemsRef.current.map((entry) => (entry.id === next.id ? next : entry))
      );
      await markDirty();
      scheduleSync();
    },
    [commitItems, markDirty, scheduleSync]
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const key = keyRef.current;
      if (!key) throw new VaultError("locked", "Unlock your vault first.");

      const existing = itemsRef.current.find((item) => item.id === id);
      if (!existing) return;

      const now = Date.now();
      const tombstone: VaultItem = { ...existing, deletedAt: now, updatedAt: now };

      await saveStoredItem({
        id,
        data: encryptItem(key, tombstone),
        updatedAt: now,
      });

      commitItems(
        itemsRef.current.map((entry) => (entry.id === id ? tombstone : entry))
      );
      await markDirty();
      scheduleSync();
    },
    [commitItems, markDirty, scheduleSync]
  );

  const toggleFavorite = useCallback(
    async (id: string) => {
      const existing = itemsRef.current.find((item) => item.id === id);
      if (!existing) return;
      await updateItem({ ...existing, favorite: !existing.favorite });
    },
    [updateItem]
  );

  const importItems = useCallback(
    async (drafts: NewVaultItem[]) => {
      const key = keyRef.current;
      if (!key) throw new VaultError("locked", "Unlock your vault first.");
      if (drafts.length === 0) return;

      const now = Date.now();
      const created: VaultItem[] = drafts.map((draft, index) => ({
        ...draft,
        urls: draft.urls ?? [],
        favorite: Boolean(draft.favorite),
        id: newItemId(),
        createdAt: now + index,
        updatedAt: now + index,
        deletedAt: null,
      }));

      await replaceAllStoredItems([
        ...toStoredItems(created, key),
        ...(await getStoredItems()),
      ]);

      commitItems([...created, ...itemsRef.current]);
      await markDirty();
      scheduleSync();
    },
    [commitItems, markDirty, scheduleSync]
  );

  const moveGroup = useCallback(
    async (from: string, to: string | null) => {
      const key = keyRef.current;
      if (!key) throw new VaultError("locked", "Unlock your vault first.");

      const source = from.trim();
      const target = to?.trim() || null;
      if (!source || source === target) return;

      const now = Date.now();
      let changed = false;
      const updated: VaultItem[] = [];
      const next = itemsRef.current.map((item) => {
        if (item.deletedAt || item.folder?.trim() !== source) return item;
        changed = true;
        const copy: VaultItem = {
          ...item,
          folder: target || undefined,
          updatedAt: now + updated.length,
        };
        updated.push(copy);
        return copy;
      });

      if (!changed) return;

      await saveStoredItems(toStoredItems(updated, key));
      commitItems(next);
      await markDirty();
      scheduleSync();
    },
    [commitItems, markDirty, scheduleSync]
  );

  const renameGroup = useCallback(
    async (from: string, to: string) => {
      const target = to.trim().replace(/\s+/g, " ");
      if (!target) throw new VaultError("invalid_input", "Enter a group name.");
      if (target.length > 80) {
        throw new VaultError("invalid_input", "Group names are limited to 80 characters.");
      }
      await moveGroup(from, target);
    },
    [moveGroup]
  );

  const deleteGroup = useCallback(
    async (name: string) => {
      await moveGroup(name, null);
    },
    [moveGroup]
  );

  /* ------------------------------ server ----------------------------- */

  const persistSession = useCallback(async (next: ServerSession) => {
    sessionRef.current = next;
    setSession(next);
    await setSessionToken(next.token);
    await setManyMeta({
      [META.serverUrl]: next.url,
      [META.serverEmail]: next.email,
      [META.serverRevision]: String(next.revision),
      [META.serverTotpEnabled]: next.totpEnabled ? "1" : "0",
    });
  }, []);

  const connectServer = useCallback(
    async (input: ConnectServerInput): Promise<ConnectServerResult> => {
      const url = normalizeServerUrl(input.url);
      const email = input.email.trim().toLowerCase();
      if (!email) throw new VaultError("invalid_input", "Enter your account email.");

      let prelogin: PreloginResponse | null = null;
      try {
        prelogin = await api.prelogin(url, email);
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "account_not_found") {
          throw error;
        }
      }

      if (!prelogin) {
        if (!input.createIfMissing || input.fresh) {
          throw new VaultError(
            "account_not_found",
            "No account exists for this email on that server."
          );
        }

        const meta = await getAllMeta();
        const salt = meta[META.kdfSalt];
        if (!salt) throw new VaultError("no_vault", "Create your vault first.");

        const iterations = Number(meta[META.kdfIterations] ?? KDF_ITERATIONS);
        const derived = await deriveKeys(input.password, salt, iterations);
        const storedCheck = meta[META.keyCheck];
        if (storedCheck && keyCheck(derived.encryptionKey) !== storedCheck) {
          throw new VaultError(
            "invalid_password",
            "That master password does not match this vault."
          );
        }

        const auth = await api.register(url, {
          email,
          authHash: derived.authHash,
          kdfSalt: salt,
          kdfIterations: iterations,
        });

        const nextSession: ServerSession = {
          url,
          email,
          token: auth.token,
          revision: auth.revision,
          totpEnabled: auth.totpEnabled,
        };
        await persistSession(nextSession);
        setServerProfile(profileFromAuth(auth));

        dirtyRef.current = true;
        await setMeta(META.dirty, "1");
        try {
          await syncNow();
        } catch {
          // The account is created; unsynced items remain marked dirty.
        }
        return { mode: "created" };
      }

      const derived = await deriveKeys(
        input.password,
        prelogin.kdfSalt,
        prelogin.kdfIterations
      );

      const auth = await api.login(url, {
        email,
        authHash: derived.authHash,
        totpCode: input.totpCode,
      });
      setServerProfile(profileFromAuth(auth));

      if (input.fresh) {
        const remote = await api.getVault(url, auth.token);
        const decrypted = decryptRows(remote.items, derived.encryptionKey);
        const localLegacy = legacyItems();
        const nextItems = [...decrypted, ...localLegacy];

        await setManyMeta({
          [META.kdfSalt]: prelogin.kdfSalt,
          [META.kdfIterations]: String(prelogin.kdfIterations),
          [META.keyCheck]: keyCheck(derived.encryptionKey),
          [META.createdAt]: String(auth.createdAt),
          [META.legacyImported]: "1",
          [META.dirty]: localLegacy.length > 0 ? "1" : "0",
          [META.lastSyncedAt]: String(Date.now()),
        });
        await persistItems(nextItems, derived.encryptionKey);

        keyRef.current = derived.encryptionKey;
        dirtyRef.current = localLegacy.length > 0;
        commitItems(nextItems);
        setStatus("unlocked");

        await persistSession({
          url,
          email,
          token: auth.token,
          revision: remote.revision,
          totpEnabled: auth.totpEnabled,
        });

        if (localLegacy.length > 0) {
          try {
            await syncNow();
          } catch {
            // Retried on next unlock or manual sync.
          }
        }
        return { mode: "signed_in" };
      }

      const meta = await getAllMeta();
      const localSalt = meta[META.kdfSalt];
      if (!localSalt) throw new VaultError("no_vault", "Create your vault first.");

      if (localSalt !== prelogin.kdfSalt) {
        if (!input.replaceLocal) {
          throw new VaultError(
            "salt_mismatch",
            "This device's vault uses a different master password. You can replace it with the server copy."
          );
        }

        const remote = await api.getVault(url, auth.token);
        const decrypted = decryptRows(remote.items, derived.encryptionKey);

        await setManyMeta({
          [META.kdfSalt]: prelogin.kdfSalt,
          [META.kdfIterations]: String(prelogin.kdfIterations),
          [META.keyCheck]: keyCheck(derived.encryptionKey),
          [META.createdAt]: String(auth.createdAt),
          [META.legacyImported]: "1",
          [META.dirty]: "0",
          [META.lastSyncedAt]: String(Date.now()),
        });
        await persistItems(decrypted, derived.encryptionKey);

        keyRef.current = derived.encryptionKey;
        dirtyRef.current = false;
        commitItems(decrypted);
        setStatus("unlocked");
        setSyncStatus("success");

        await persistSession({
          url,
          email,
          token: auth.token,
          revision: remote.revision,
          totpEnabled: auth.totpEnabled,
        });
        return { mode: "replaced" };
      }

      const storedCheck = meta[META.keyCheck];
      if (storedCheck && keyCheck(derived.encryptionKey) !== storedCheck) {
        throw new VaultError(
          "invalid_password",
          "That master password does not match this vault."
        );
      }

      await persistSession({
        url,
        email,
        token: auth.token,
        revision: auth.revision,
        totpEnabled: auth.totpEnabled,
      });
      dirtyRef.current = meta[META.dirty] === "1";

      try {
        await syncNow();
      } catch {
        // Offline is fine — the local vault remains available.
      }

      return { mode: "signed_in" };
    },
    [legacyItems, persistItems, persistSession, syncNow]
  );

  const disconnectServer = useCallback(async () => {
    sessionRef.current = null;
    setSession(null);
    setServerProfile(null);
    setSyncStatus("idle");
    setSyncError(null);
    await setSessionToken(null);
    await setManyMeta({
      [META.serverUrl]: "",
      [META.serverEmail]: "",
      [META.serverRevision]: "0",
      [META.serverTotpEnabled]: "0",
    });
  }, []);

  const refreshServerProfile = useCallback(async () => {
    const current = sessionRef.current;
    if (!current?.token) {
      throw new VaultError("not_connected", "Connect a sync server first.");
    }
    const profile = await api.me(current.url, current.token);
    setServerProfile(profile);
    return profile;
  }, []);

  const requireToken = useCallback((): ServerSession & { token: string } => {
    const current = sessionRef.current;
    if (!current?.token) {
      throw new VaultError("not_connected", "Connect a sync server first.");
    }
    return current as ServerSession & { token: string };
  }, []);

  const setupServerTotp = useCallback(async () => {
    const current = requireToken();
    const challenge = await api.setupTotp(current.url, current.token);
    return { secret: challenge.secret, otpauthUrl: challenge.otpauthUrl };
  }, [requireToken]);

  const enableServerTotp = useCallback(
    async (code: string) => {
      const current = requireToken();
      await api.enableTotp(current.url, current.token, code);
      const next: ServerSession = { ...current, totpEnabled: true };
      sessionRef.current = next;
      setSession(next);
      await setManyMeta({ [META.serverTotpEnabled]: "1" });
      setServerProfile((profile) =>
        profile ? { ...profile, totpEnabled: true } : profile
      );
    },
    [requireToken]
  );

  const disableServerTotp = useCallback(
    async (code: string) => {
      const current = requireToken();
      await api.disableTotp(current.url, current.token, code);
      const next: ServerSession = { ...current, totpEnabled: false };
      sessionRef.current = next;
      setSession(next);
      await setManyMeta({ [META.serverTotpEnabled]: "0" });
      setServerProfile((profile) =>
        profile ? { ...profile, totpEnabled: false } : profile
      );
    },
    [requireToken]
  );

  /* ----------------------------- settings ---------------------------- */

  const setAutoLockMinutes = useCallback(async (value: number) => {
    const safe = Math.max(0, Math.round(value));
    const next = { ...settingsRef.current, autoLockMinutes: safe };
    settingsRef.current = next;
    setSettings(next);
    await setMeta(META.autoLockMinutes, String(safe));
  }, []);

  const setThemeMode = useCallback(async (value: ThemeMode) => {
    const next = { ...settingsRef.current, themeMode: value };
    settingsRef.current = next;
    setSettings(next);
    await setMeta(META.themeMode, value);
  }, []);

  const setAutofillEnabled = useCallback(async (value: boolean) => {
    if (value && !hasNativeAutofill()) {
      throw new VaultError(
        "invalid_input",
        "System autofill requires the installed Android app, not Expo Go."
      );
    }

    const next = { ...settingsRef.current, autofillEnabled: value };
    settingsRef.current = next;
    setSettings(next);
    setSettingsLoaded(true);
    await setMeta(META.autofillEnabled, value ? "1" : "0");

    if (!value) {
      await clearAutofillCache();
      return;
    }

    if (statusRef.current === "unlocked") {
      await configureAutofill(itemsRef.current);
    }
  }, []);

  const enableBiometrics = useCallback(async (password: string) => {
    if (Platform.OS === "web") {
      throw new VaultError(
        "biometric_unavailable",
        "Biometric unlock is available in the mobile app."
      );
    }

    const hardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!hardware || !enrolled) {
      throw new VaultError(
        "biometric_unavailable",
        "Set up Face ID or a fingerprint in your device settings first."
      );
    }

    const meta = await getAllMeta();
    const salt = meta[META.kdfSalt];
    if (!salt) throw new VaultError("no_vault", "No vault exists on this device.");

    const derived = await deriveKeys(
      password,
      salt,
      Number(meta[META.kdfIterations] ?? KDF_ITERATIONS)
    );
    const storedCheck = meta[META.keyCheck];
    if (storedCheck && keyCheck(derived.encryptionKey) !== storedCheck) {
      throw new VaultError("invalid_password", "That master password is incorrect.");
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: "Enable biometric unlock",
      cancelLabel: "Cancel",
    });
    if (!result.success) {
      throw new VaultError("biometric_cancelled", "Biometric setup was cancelled.");
    }

    await setBiometricKey(bytesToBase64(derived.encryptionKey));
    const next = { ...settingsRef.current, biometricsEnabled: true };
    settingsRef.current = next;
    setSettings(next);
    await setMeta(META.biometricsEnabled, "1");
    setBiometricAvailable(true);
  }, []);

  const disableBiometrics = useCallback(async () => {
    await setBiometricKey(null);
    const next = { ...settingsRef.current, biometricsEnabled: false };
    settingsRef.current = next;
    setSettings(next);
    await setMeta(META.biometricsEnabled, "0");
  }, []);

  /* ------------------------------ backup ----------------------------- */

  const exportBackup = useCallback(async () => {
    const meta = await getAllMeta();
    if (!meta[META.kdfSalt]) {
      throw new VaultError("no_vault", "No vault exists on this device.");
    }
    const rows = await getStoredItems();
    return JSON.stringify(
      {
        format: "flexivault-backup",
        version: 1,
        exportedAt: new Date().toISOString(),
        kdfSalt: meta[META.kdfSalt],
        kdfIterations: Number(meta[META.kdfIterations] ?? KDF_ITERATIONS),
        keyCheck: meta[META.keyCheck] ?? null,
        items: rows,
      },
      null,
      2
    );
  }, []);

  const resetVault = useCallback(async () => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    // Reset removes the entire queue, including entries JS cannot parse. Stop
    // before wiping the vault if native storage cannot persist the removal.
    await clearAllPendingAutofillSaves();
    await wipeDatabase();
    await setSessionToken(null);
    await setBiometricKey(null);
    await clearAutofillCache().catch(() => {});
    await clearNativePasskeys().catch(() => {});

    keyRef.current = null;
    itemsRef.current = [];
    sessionRef.current = null;
    dirtyRef.current = false;

    setItems([]);
    setSession(null);
    setServerProfile(null);
    setSyncStatus("idle");
    setSyncError(null);
    setLastSyncedAt(null);
    setSettings(DEFAULT_SETTINGS);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettingsLoaded(true);

    const legacy = await readLegacyEntries();
    legacyRef.current = legacy;
    setLegacyCount(legacy.length);
    setStatus("onboarding");
  }, []);

  const value = useMemo<VaultContextValue>(
    () => ({
      status,
      items,
      settings,
      session,
      serverProfile,
      syncStatus,
      syncError,
      lastSyncedAt,
      legacyCount,
      biometricAvailable,
      createVault,
      unlock,
      unlockWithBiometrics,
      lock,
      addItem,
      updateItem,
      deleteItem,
      toggleFavorite,
      importItems,
      renameGroup,
      deleteGroup,
      connectServer,
      disconnectServer,
      syncNow,
      refreshServerProfile,
      setupServerTotp,
      enableServerTotp,
      disableServerTotp,
      setAutoLockMinutes,
      setThemeMode,
      setAutofillEnabled,
      enableBiometrics,
      disableBiometrics,
      exportBackup,
      resetVault,
    }),
    [
      status,
      items,
      settings,
      session,
      serverProfile,
      syncStatus,
      syncError,
      lastSyncedAt,
      legacyCount,
      biometricAvailable,
      createVault,
      unlock,
      unlockWithBiometrics,
      lock,
      addItem,
      updateItem,
      deleteItem,
      toggleFavorite,
      importItems,
      renameGroup,
      deleteGroup,
      connectServer,
      disconnectServer,
      syncNow,
      refreshServerProfile,
      setupServerTotp,
      enableServerTotp,
      disableServerTotp,
      setAutoLockMinutes,
      setThemeMode,
      setAutofillEnabled,
      enableBiometrics,
      disableBiometrics,
      exportBackup,
      resetVault,
    ]
  );

  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>;
}
