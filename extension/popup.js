import { ApiError, api, normalizeServerUrl } from "./src/api.js";
import {
  base64ToBytes,
  bytesToBase64,
  decryptItem,
  deriveKeys,
  importVaultKey,
  keyCheck,
} from "./src/crypto.js";
import {
  formatTotpCode,
  generateTotp,
  secondsRemaining,
} from "./src/otp.js";
import { sameSite, siteHost, withScheme } from "./src/presentation.js";
import {
  CACHE_KEY,
  CONFIG_KEY,
  isSessionFresh,
  local,
  mergeItems,
  session,
  touchSession,
} from "./src/store.js";
import {
  QUICK_KEY,
  enrollTotp,
  isQuickUnlockGone,
  quickErrorMessage,
  readQuickUnlock,
  revokeTotp,
  totpNeedsRefresh,
  unlockWithTotp,
  writeQuickUnlock,
} from "./src/quick-unlock.js";
import { pushDirtyCache } from "./src/sync.js";
import { appHtml, vaultListHtml } from "./src/ui.js";

const PULL_ON_OPEN_MS = 15_000;
const appEl = document.getElementById("app");
const toastEl = document.getElementById("toast");
const fullPage =
  document.documentElement.classList.contains("fullpage") ||
  document.body.classList.contains("fullpage");

const state = {
  view: "loading",
  fullPage,
  config: null,
  cache: { items: [], revision: 0, lastSyncedAt: 0, dirty: false },
  items: [],
  session: null,
  selectedId: null,
  filter: "all",
  form: { serverUrl: "", email: "", password: "", totp: "", code: "", query: "" },
  quick: null,
  quickBusy: false,
  focusField: null,
  reveal: {},
  busy: false,
  syncing: false,
  error: null,
  needsTotp: false,
  currentTotp: "",
  disconnectArmed: false,
  pullPromise: null,
};

let toastTimer = null;
let lastActiveTouch = 0;

/* ------------------------------- helpers ------------------------------- */

function toast(message, tone = "success") {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.className = `toast show ${tone}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = "toast";
  }, 2300);
}

function render() {
  const queryFocused = document.activeElement?.dataset?.field === "query";
  const selection = queryFocused ? document.activeElement.selectionStart : 0;

  appEl.dataset.view = state.view;
  appEl.innerHTML = appHtml(state);

  if (queryFocused) {
    const input = document.querySelector('[data-field="query"]');
    if (input) {
      input.focus();
      const position = Math.min(selection ?? input.value.length, input.value.length);
      input.setSelectionRange(position, position);
    }
  } else if ((state.view === "locked" || state.view === "setup") && !state.busy) {
    const preferCode = state.view === "locked" && state.quick?.totp && state.focusField !== "password";
    const input = document.getElementById(preferCode ? "quick-code" : "password");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  if (state.view === "detail") updateDetailTotp();
}

function friendly(error) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "account_not_found":
        return "No FlexiVault account exists for that email on this server. Create the vault in the mobile app first.";
      case "invalid_credentials":
        return "That email and master password do not match this server account.";
      case "totp_required":
        return "Enter the current 6-digit code for this account.";
      case "invalid_totp":
        return "That two-factor code did not match. Try the next one.";
      case "unauthorized":
        return "This browser's session expired. Unlock again to sign in.";
      case "network_error":
        return "Could not reach the server. Check the URL and your connection.";
      default:
        return error.message;
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

function sortItems(items) {
  return items.slice().sort((left, right) => {
    if (Boolean(left.favorite) !== Boolean(right.favorite)) {
      return left.favorite ? -1 : 1;
    }
    return Number(right.updatedAt) - Number(left.updatedAt);
  });
}

async function decryptRows(encryptionKey, rows) {
  const key = await importVaultKey(encryptionKey);
  return Promise.all(rows.map((row) => decryptItem(key, row.data)));
}

async function saveCache(rows, revision, options = {}) {
  state.cache = {
    items: rows,
    revision: Number(revision ?? 0),
    lastSyncedAt: options.keepSyncTime
      ? Number(state.cache?.lastSyncedAt ?? 0)
      : Date.now(),
    dirty: Boolean(options.dirty),
  };
  await local.set({ [CACHE_KEY]: state.cache });
}

async function markActive() {
  if (!state.session) return;
  if (Date.now() - lastActiveTouch < 15_000) return;
  lastActiveTouch = Date.now();
  const stored = await session.get();
  if (stored?.encryptionKeyB64) {
    state.session = await touchSession(stored);
  }
}

/* ------------------------------- actions ------------------------------- */

async function boot() {
  try {
    const stored = await local.get([CONFIG_KEY, CACHE_KEY]);
    state.config = stored[CONFIG_KEY] ?? null;
    state.cache = stored[CACHE_KEY] ?? {
      items: [],
      revision: 0,
      lastSyncedAt: 0,
      dirty: false,
    };

    if (!state.config) {
      state.view = "setup";
      render();
      return;
    }

    state.form.email = state.config.email ?? "";
    state.form.serverUrl = state.config.serverUrl ?? "";
    state.quick = await readQuickUnlock(state.config);

    const storedSession = await session.get();
    if (
      storedSession?.encryptionKeyB64 &&
      isSessionFresh(storedSession) &&
      (!state.config.keyCheck ||
        (await keyCheck(base64ToBytes(storedSession.encryptionKeyB64))) ===
          state.config.keyCheck)
    ) {
      state.session = storedSession;
      const items = await decryptRows(
        base64ToBytes(storedSession.encryptionKeyB64),
        state.cache.items ?? []
      );
      state.items = sortItems(items);
      state.view = "vault";
      render();
      if (
        state.cache.dirty ||
        Date.now() - Number(state.cache.lastSyncedAt ?? 0) > PULL_ON_OPEN_MS
      ) {
        pull({ silent: true });
      }
      return;
    }

    await session.clear();
    if (storedSession?.token) {
      // Keep the bearer token so unlocking can re-authenticate silently.
      await session.set({ token: storedSession.token });
    }
    state.view = "locked";
    render();
  } catch (error) {
    state.view = "locked";
    state.error = friendly(error);
    render();
  }
}

async function doConnect() {
  if (state.busy) return;

  const serverUrl = state.form.serverUrl.trim();
  const email = state.form.email.trim().toLowerCase();
  const password = state.form.password;

  if (!serverUrl || !email || !password) {
    state.error = "Enter the server URL, email and master password.";
    render();
    return;
  }

  state.busy = true;
  state.error = null;
  render();

  try {
    const url = normalizeServerUrl(serverUrl);
    const prelogin = await api.prelogin(url, email);
    const derived = await deriveKeys(
      password,
      prelogin.kdfSalt,
      prelogin.kdfIterations
    );

    let auth;
    try {
      auth = await api.login(url, {
        email,
        authHash: derived.authHash,
        totpCode: state.form.totp.trim() || undefined,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === "totp_required" || error.code === "invalid_totp")
      ) {
        state.needsTotp = true;
      }
      throw error;
    }

    const remote = await api.getVault(url, auth.token);
    const items = await decryptRows(derived.encryptionKey, remote.items);

    const config = {
      serverUrl: url,
      email,
      kdfSalt: prelogin.kdfSalt,
      kdfIterations: prelogin.kdfIterations,
      keyCheck: await keyCheck(derived.encryptionKey),
    };

    const nextSession = {
      encryptionKeyB64: bytesToBase64(derived.encryptionKey),
      token: auth.token,
      unlockedAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    await local.set({
      [CONFIG_KEY]: config,
      [CACHE_KEY]: {
        items: remote.items,
        revision: Number(remote.revision ?? 0),
        lastSyncedAt: Date.now(),
        dirty: false,
      },
    });
    await session.set(nextSession);

    state.config = config;
    state.cache = {
      items: remote.items,
      revision: Number(remote.revision ?? 0),
      lastSyncedAt: Date.now(),
      dirty: false,
    };
    state.session = nextSession;
    state.items = sortItems(items);
    state.needsTotp = false;
    state.view = "vault";
    state.error = null;
    state.busy = false;
    state.form.password = "";
    state.form.totp = "";
    render();
    toast("Vault connected", "success");
  } catch (error) {
    state.busy = false;
    state.error = friendly(error);
    render();
  }
}

async function loadRemoteForUnlock(config, token, encryptionKey) {
  let cache = state.cache ?? {
    items: [],
    revision: 0,
    lastSyncedAt: 0,
    dirty: false,
  };
  let pending = Boolean(cache.dirty);

  // An inline save is written locally first. Flush it before replacing the
  // cache with the remote snapshot so an offline save is not lost.
  if (pending) {
    try {
      const pushed = await pushDirtyCache({
        config,
        session: { token },
        cache,
      });
      cache = pushed.cache;
      pending = false;
      await saveCache(cache.items, cache.revision, { dirty: false });
    } catch {
      // Keep the dirty cache and merge it with the remote snapshot below.
    }
  }

  const remote = await api.getVault(config.serverUrl, token);
  const rows = pending
    ? mergeItems(cache.items ?? [], remote.items)
    : remote.items;
  const items = await decryptRows(encryptionKey, rows);
  await saveCache(rows, remote.revision, { dirty: pending });
  return { items, pending };
}

async function doUnlock() {
  if (state.busy) return;

  if (!state.config) {
    state.view = "setup";
    render();
    return;
  }
  state.focusField = "password";
  if (!state.form.password) {
    state.error = "Enter your master password.";
    render();
    return;
  }

  state.busy = true;
  state.error = null;
  render();

  try {
    const config = state.config;
    const derived = await deriveKeys(
      state.form.password,
      config.kdfSalt,
      config.kdfIterations
    );

    if (config.keyCheck) {
      const check = await keyCheck(derived.encryptionKey);
      if (check !== config.keyCheck) {
        throw new Error("That master password is incorrect.");
      }
    }

    let localItems;
    try {
      localItems = await decryptRows(
        derived.encryptionKey,
        state.cache.items ?? []
      );
    } catch {
      throw new Error("That master password is incorrect.");
    }

    const storedSession = await session.get();
    let token = storedSession?.token ?? null;
    let pulled = false;
    let items = localItems;

    if (token) {
      try {
        const loaded = await loadRemoteForUnlock(
          config,
          token,
          derived.encryptionKey
        );
        items = loaded.items;
        pulled = true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          token = null;
        } else if (localItems.length === 0) {
          throw new Error(
            "Could not reach the server, and there is no cached vault on this browser yet."
          );
        }
      }
    }

    if (!token) {
      let auth;
      try {
        auth = await api.login(config.serverUrl, {
          email: config.email,
          authHash: derived.authHash,
          totpCode: state.form.totp.trim() || undefined,
        });
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.code === "totp_required" || error.code === "invalid_totp")
        ) {
          state.needsTotp = true;
        }
        throw error;
      }
      token = auth.token;

      if (!pulled) {
        const loaded = await loadRemoteForUnlock(
          config,
          token,
          derived.encryptionKey
        );
        items = loaded.items;
        pulled = true;
      }
    }

    if (!pulled && items.length === 0 && (state.cache.items?.length ?? 0) === 0) {
      const loaded = await loadRemoteForUnlock(
        config,
        token,
        derived.encryptionKey
      );
      items = loaded.items;
    }

    await enterVault(derived.encryptionKey, token, items);
    void refreshCodeUnlock(derived.encryptionKey, token);
  } catch (error) {
    state.busy = false;
    state.error = friendly(error);
    render();
  }
}

async function enterVault(encryptionKey, token, items) {
  const config = state.config;
  const nextSession = {
    encryptionKeyB64: bytesToBase64(encryptionKey),
    token,
    unlockedAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  await session.set(nextSession);

  if (!config.keyCheck) {
    config.keyCheck = await keyCheck(encryptionKey);
    await local.set({ [CONFIG_KEY]: config });
  }

  state.session = nextSession;
  state.items = sortItems(items);
  state.view = "vault";
  state.error = null;
  state.needsTotp = false;
  state.busy = false;
  state.focusField = null;
  state.form.password = "";
  state.form.totp = "";
  state.form.code = "";
  render();
  toast(
    state.cache.dirty ? "Unlocked. Sync pending." : "Vault unlocked",
    state.cache.dirty ? "danger" : "success"
  );
}

/** A master-password unlock silently renews code unlock before it expires. */
async function refreshCodeUnlock(encryptionKey, token) {
  const quick = await readQuickUnlock(state.config);
  if (!token || !quick?.totp || !totpNeedsRefresh(quick.totp)) return;
  try {
    const totp = await enrollTotp(state.config, token, encryptionKey, quick.totp);
    state.quick = await writeQuickUnlock(state.config, { totp });
  } catch {
    // Keep the current share; it still works until it expires.
  }
}

async function doCodeUnlock() {
  if (state.busy || !state.config) return;
  state.focusField = "code";
  state.busy = true;
  state.error = null;
  render();

  try {
    const config = state.config;
    let result;
    try {
      result = await unlockWithTotp(config, state.quick?.totp, state.form.code);
    } catch (error) {
      if (isQuickUnlockGone(error)) {
        state.quick = await writeQuickUnlock(config, { totp: null });
      }
      throw new Error(quickErrorMessage(error));
    } finally {
      state.form.code = "";
    }

    let items = await decryptRows(result.rawKey, state.cache.items ?? []);
    try {
      items = (await loadRemoteForUnlock(config, result.token, result.rawKey)).items;
    } catch {
      // The release itself reached the server; a failed pull keeps the cache.
    }
    await enterVault(result.rawKey, result.token, items);
  } catch (error) {
    state.busy = false;
    state.error = friendly(error);
    render();
  }
}

function openUnlockWindow(mode) {
  return chrome.windows.create({
    url: `${chrome.runtime.getURL("unlock.html")}?mode=${mode}`,
    type: "popup",
    width: 400,
    height: 540,
    focused: true,
  });
}

async function toggleCodeUnlock() {
  if (state.quickBusy || !state.config) return;
  state.quickBusy = true;
  state.error = null;
  render();
  try {
    const quick = await readQuickUnlock(state.config);
    if (quick?.totp) {
      await revokeTotp(state.config, quick.totp);
      state.quick = await writeQuickUnlock(state.config, { totp: null });
      toast("Code unlock turned off");
    } else {
      const current = await session.get();
      if (!current?.encryptionKeyB64) throw new Error("Unlock your vault first.");
      const totp = await enrollTotp(state.config, current.token,
        base64ToBytes(current.encryptionKeyB64), null);
      state.quick = await writeQuickUnlock(state.config, { totp });
      toast("Code unlock is on");
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === "totp_disabled") {
      state.error = "Turn on two-factor for your server account in the mobile app first (Settings → Server → Two-factor).";
    } else if (error instanceof ApiError && error.status === 401) {
      state.error = "Your server session expired. Lock, then unlock once with your master password.";
    } else {
      state.error = friendly(error);
    }
  } finally {
    state.quickBusy = false;
    render();
  }
}

async function togglePasskeyUnlock() {
  if (state.quickBusy || !state.config) return;
  const quick = await readQuickUnlock(state.config);
  if (quick?.passkey) {
    state.quick = await writeQuickUnlock(state.config, { passkey: null });
    render();
    toast("Passkey unlock removed");
    return;
  }
  // WebAuthn closes the toolbar popup when the OS dialog takes focus, so the
  // ceremony runs in a small extension window instead.
  await openUnlockWindow("passkey-setup");
}

async function lockVault(automatic = false) {
  const stored = await session.get();
  if (stored) await session.set({ token: stored.token ?? null });

  state.session = null;
  state.items = [];
  state.selectedId = null;
  state.reveal = {};
  state.form.password = "";
  state.form.totp = "";
  state.form.code = "";
  state.focusField = null;
  state.needsTotp = false;
  state.error = null;
  state.disconnectArmed = false;
  state.view = state.config ? "locked" : "setup";
  render();
  if (!automatic) toast("Vault locked");
}

async function pull(options = {}) {
  const silent = Boolean(options.silent);

  if (!state.session?.token || !state.session.encryptionKeyB64) {
    if (!silent) toast("Unlock the vault to sync.", "danger");
    return;
  }
  if (state.pullPromise) return state.pullPromise;

  state.pullPromise = (async () => {
    if (!silent) {
      state.syncing = true;
      state.error = null;
      render();
    }

    try {
      let cache = state.cache ?? {
        items: [],
        revision: 0,
        lastSyncedAt: 0,
        dirty: false,
      };
      let pending = Boolean(cache.dirty);

      // A login saved by the inline prompt is written locally first. Flush it
      // before pulling so the server revision advances and the new row is not
      // treated as a remote-only change.
      if (pending) {
        try {
          const pushed = await pushDirtyCache({
            config: state.config,
            session: state.session,
            cache,
          });
          cache = pushed.cache;
          pending = false;
          await saveCache(cache.items, cache.revision, { dirty: false });
        } catch {
          // Keep the dirty cache and merge it with the remote snapshot below.
        }
      }

      const remote = await api.getVault(
        state.config.serverUrl,
        state.session.token
      );
      const rows = pending
        ? mergeItems(cache.items ?? [], remote.items)
        : remote.items;
      const items = await decryptRows(
        base64ToBytes(state.session.encryptionKeyB64),
        rows
      );

      state.items = sortItems(items);
      await saveCache(rows, remote.revision, { dirty: pending });

      if (!silent) {
        toast(
          pending ? "Saved locally — sync pending." : "Vault synced",
          pending ? "danger" : "success"
        );
      } else if (state.view === "vault") {
        render();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        state.session = { ...state.session, token: null };
        const stored = (await session.get()) ?? {};
        await session.set({ ...stored, token: null });
        if (!silent) {
          toast("Session expired — unlock again to sign in.", "danger");
        }
      } else if (!silent) {
        toast(friendly(error), "danger");
      } else if (state.items.length === 0) {
        state.error = friendly(error);
        if (state.view === "vault") render();
      }
    } finally {
      state.pullPromise = null;
      if (!silent) {
        state.syncing = false;
        render();
      }
    }
  })();

  return state.pullPromise;
}

function currentItem() {
  return state.items.find((item) => item.id === state.selectedId);
}

async function copyText(text, label = "Copied") {
  const value = String(text ?? "");
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast(label, "success");
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    toast(label, "success");
  }
}

function copyItemField(id, field) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  const values = {
    username: item.username,
    password: item.password,
    cardNumber: item.card?.number,
    cardHolder: item.card?.holder,
    cvv: item.card?.cvv,
    fullName: item.identity?.fullName,
    identityEmail: item.identity?.email,
    phone: item.identity?.phone,
    address: item.identity?.address,
  };
  copyText(values[field], `${field === "password" ? "Password" : "Copied"}`);
}

async function copyTotp() {
  const item = currentItem();
  if (!item?.totp?.secret) return;
  try {
    const code = await generateTotp(item.totp);
    await copyText(code, "Code copied");
  } catch (error) {
    toast(error.message, "danger");
  }
}

async function sendFillMessage(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    const text = String(error?.message ?? "");
    if (!/Receiving end does not exist|Could not establish connection/i.test(text)) {
      throw error;
    }
    // Tabs opened before the extension was installed or reloaded do not have
    // the content script yet. Inject it once and retry.
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function fillItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  if (!item.password) {
    toast("This item has no password saved.", "danger");
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab found.");

    const activeSite = siteHost(tab.url ?? "");
    const savedSites = (item.urls ?? []).map((value) => siteHost(value)).filter(Boolean);
    if (savedSites.length > 0) {
      if (!activeSite) {
        throw new Error(
          "Autofill blocked: could not verify the active tab's address."
        );
      }
      if (!savedSites.some((site) => sameSite(site, activeSite))) {
        throw new Error(
          `Autofill blocked: this login is saved for ${savedSites.join(
            ", "
          )}, not ${activeSite}.`
        );
      }
    }

    const response = await sendFillMessage(tab.id, {
      type: "flexivault:fill",
      username: item.username ?? "",
      password: item.password,
    });
    if (!response?.ok) {
      throw new Error(response?.message ?? "No login form found on this page.");
    }
    toast(
      `Filled ${response.filled} field${response.filled === 1 ? "" : "s"}`,
      "success"
    );
  } catch (error) {
    toast(
      error.message?.includes("Receiving end does not exist")
        ? "Reload the page, then try autofill again."
        : error.message ?? "Could not autofill this page.",
      "danger"
    );
  }
}

async function openItemUrl(id) {
  const item = state.items.find((entry) => entry.id === id);
  const value = item?.urls?.find((url) => url?.trim());
  if (!value) {
    toast("This item has no website saved.", "danger");
    return;
  }
  await chrome.tabs.create({ url: withScheme(value) });
}

async function copyCurrentTotp() {
  const el = document.getElementById("totp-code");
  const code = state.currentTotp || el?.textContent?.replace(/\s+/g, "");
  if (!code) {
    await copyTotp();
    return;
  }
  await copyText(code, "Code copied");
}

function updateDetailTotp() {
  if (state.view !== "detail") return;
  const item = currentItem();
  if (!item?.totp?.secret) return;

  const codeEl = document.getElementById("totp-code");
  if (!codeEl) return;

  generateTotp(item.totp)
    .then((code) => {
      if (state.view !== "detail" || state.selectedId !== item.id) return;
      state.currentTotp = code;
      codeEl.textContent = formatTotpCode(code);

      const period = item.totp.period > 0 ? item.totp.period : 30;
      const remaining = secondsRemaining(period);
      const progress = Math.max(0, Math.min(1, remaining / period));
      const urgent = remaining <= 5;

      codeEl.style.color = urgent ? "var(--danger)" : "var(--text)";

      const remainingEl = document.getElementById("totp-remaining");
      if (remainingEl) {
        remainingEl.textContent = `${remaining}s`;
        remainingEl.style.color = urgent ? "var(--danger)" : "";
      }

      const bar = document.getElementById("totp-progress");
      if (bar) {
        bar.style.width = `${progress * 100}%`;
        bar.style.background = urgent ? "var(--danger)" : "var(--accent)";
      }
    })
    .catch(() => {
      codeEl.textContent = "Invalid secret";
    });
}

async function disconnect() {
  if (!state.disconnectArmed) {
    state.disconnectArmed = true;
    render();
    return;
  }

  const quick = await readQuickUnlock(state.config);
  if (quick?.totp) await revokeTotp(state.config, quick.totp);
  await local.remove([CONFIG_KEY, CACHE_KEY, QUICK_KEY]);
  await session.clear();
  await chrome.storage.session.clear();

  state.config = null;
  state.cache = { items: [], revision: 0, lastSyncedAt: 0 };
  state.items = [];
  state.session = null;
  state.form = { serverUrl: "", email: "", password: "", totp: "", code: "", query: "" };
  state.quick = null;
  state.disconnectArmed = false;
  state.view = "setup";
  state.error = null;
  render();
  toast("This browser was disconnected", "danger");
}

/* ------------------------------- events -------------------------------- */

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  markActive();

  switch (target.dataset.action) {
    case "open-item":
      state.selectedId = target.dataset.id;
      state.reveal = {};
      state.error = null;
      state.view = "detail";
      render();
      break;

    case "back":
      state.view = "vault";
      state.error = null;
      state.disconnectArmed = false;
      render();
      break;

    case "settings":
      state.view = "settings";
      state.error = null;
      state.disconnectArmed = false;
      render();
      break;

    case "setup":
      state.view = "setup";
      state.error = null;
      state.needsTotp = false;
      state.form.password = "";
      state.form.totp = "";
      state.form.serverUrl = state.config?.serverUrl ?? state.form.serverUrl;
      state.form.email = state.config?.email ?? state.form.email;
      render();
      break;

    case "cancel-setup":
      state.view = state.config ? "locked" : "setup";
      state.error = null;
      state.needsTotp = false;
      state.form.password = "";
      state.form.totp = "";
      render();
      break;

    case "filter":
      state.filter = target.dataset.filter ?? "all";
      render();
      break;

    case "clear-filters":
      state.filter = "all";
      state.form.query = "";
      render();
      break;

    case "reveal": {
      const key = target.dataset.key;
      if (key) {
        state.reveal[key] = !state.reveal[key];
        render();
      }
      break;
    }

    case "copy":
      copyItemField(target.dataset.id, target.dataset.field);
      break;

    case "copy-totp":
      copyCurrentTotp();
      break;

    case "open-url":
      openItemUrl(target.dataset.id);
      break;

    case "open-vault":
      await chrome.tabs.create({
        url: chrome.runtime.getURL("vault.html"),
      });
      break;

    case "fill":
      fillItem(target.dataset.id);
      break;

    case "sync":
      pull();
      break;

    case "lock":
      lockVault();
      break;

    case "disconnect":
      disconnect();
      break;

    case "passkey-unlock":
      await openUnlockWindow("unlock");
      if (!state.fullPage) window.close();
      break;

    case "quick-totp":
      toggleCodeUnlock();
      break;

    case "quick-passkey":
      togglePasskeyUnlock();
      break;

    default:
      break;
  }
});

document.addEventListener("input", (event) => {
  const field = event.target.dataset?.field;
  if (!field) return;

  state.form[field] = event.target.value;
  markActive();

  if ((field === "password" || field === "totp" || field === "code") && state.error) {
    state.error = null;
    document.querySelector(".callout.danger")?.remove();
  }

  if (field === "query") {
    const list = document.getElementById("vault-list");
    if (state.view === "vault" && list) {
      // Replace only the result rows so typing never rebuilds the whole popup
      // or steals focus from the search field.
      list.innerHTML = vaultListHtml(state);
      return;
    }
    render();
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();

  if (form.dataset.form === "connect") {
    doConnect();
  } else if (form.dataset.form === "unlock") {
    doUnlock();
  } else if (form.dataset.form === "quick-code") {
    doCodeUnlock();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.view === "detail" || state.view === "settings") {
      state.view = "vault";
      state.error = null;
      render();
    }
  }
});

chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[QUICK_KEY] && state.config) {
    // Passkey setup finishes in its own window; reflect it here.
    void readQuickUnlock(state.config).then((quick) => {
      state.quick = quick;
      if (["locked", "settings"].includes(state.view) && !state.busy) render();
    });
  }
  if (area !== "local" || !changes[CONFIG_KEY]) return;
  const next = changes[CONFIG_KEY].newValue;
  if (!next && state.view !== "setup") {
    state.config = null;
    lockVault(true);
  }
});

setInterval(() => {
  if (state.session && !isSessionFresh(state.session)) {
    lockVault(true);
    return;
  }
  if (state.view === "detail") updateDetailTotp();
}, 1000);

boot();
