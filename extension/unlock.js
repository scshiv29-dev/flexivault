/* Password, code and passkey entry belong to this extension origin, never to
 * the parent page. Three modes:
 * - #<token>: unlock for a website form (capability checked by the worker)
 * - ?mode=unlock: standalone unlock opened from the toolbar popup
 * - ?mode=passkey-setup: enrol a passkey while the vault is unlocked */
import { base64ToBytes, bytesToBase64, keyCheck } from "./src/crypto.js";
import { unlockCachedVault } from "./src/inline-unlock.js";
import {
  createPasskey,
  isQuickUnlockGone,
  passkeySecret,
  quickErrorMessage,
  readQuickUnlock,
  unlockWithPasskeySecret,
  unlockWithTotp,
  writeQuickUnlock,
} from "./src/quick-unlock.js";
import { CACHE_KEY, CONFIG_KEY, isSessionFresh, local, session } from "./src/store.js";

const mode = new URLSearchParams(location.search).get("mode") ?? "form";
const token = location.hash.slice(1);
const $ = (id) => document.getElementById(id);
const password = $("master-password");
const unlock = $("unlock");
const status = $("status");
const code = $("code");
const codeSubmit = $("code-submit");
const passkeyButton = $("passkey");
let busy = false;
let cancelled = false;
let config = null;
let quick = null;
let passkeyInfo = null;

async function send(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, token, ...extra });
  if (!result?.ok) throw new Error(result?.error || "Could not unlock. Try again.");
  return result;
}

function setEnabled(enabled) {
  for (const control of [password, unlock, code, codeSubmit, passkeyButton]) {
    control.disabled = !enabled;
  }
}

function showQuick(totp, passkey) {
  $("quick").hidden = !totp && !passkey;
  $("code-form").hidden = !totp;
  passkeyButton.hidden = !passkey;
}

async function storeSession(encryptionKeyB64, sessionToken) {
  const current = await session.get();
  await session.set({ encryptionKeyB64, token: sessionToken ?? current?.token ?? null,
    unlockedAt: Date.now(), lastActiveAt: Date.now() });
}

function done(message) {
  status.classList.add("ok");
  status.textContent = message;
  window.close();
}

/** Runs one unlock attempt with shared busy/error handling. */
async function attempt(label, button, work) {
  if (busy || cancelled) return;
  busy = true;
  setEnabled(false);
  const original = button.textContent;
  button.textContent = label;
  status.classList.remove("ok");
  status.textContent = "";
  try {
    await work();
  } catch (error) {
    if (cancelled) return;
    status.textContent = error?.name === "NotAllowedError"
      ? "Passkey was cancelled or timed out."
      : quickErrorMessage(error);
    setEnabled(true);
    button.textContent = original;
  } finally {
    busy = false;
    password.value = "";
    code.value = "";
  }
}

/* ------------------------------ form mode ------------------------------ */

async function initForm() {
  const info = await send("flexivault:unlock-info");
  $("target").textContent = `Continue filling on ${info.host}`;
  passkeyInfo = info.passkey;
  showQuick(info.totp, Boolean(info.passkey));
}

const formUnlock = {
  password: (value) => send("flexivault:unlock-submit", { password: value }),
  code: (value) => send("flexivault:unlock-totp", { code: value }),
  async passkey() {
    const secret = await passkeySecret(passkeyInfo);
    try {
      return await send("flexivault:unlock-passkey", { secret: bytesToBase64(secret) });
    } finally {
      secret.fill(0);
    }
  },
};

/* --------------------------- standalone mode --------------------------- */

async function initStandalone() {
  config = (await local.get(CONFIG_KEY))[CONFIG_KEY];
  if (!config?.keyCheck) throw new Error("Connect your vault in the extension first.");
  quick = await readQuickUnlock(config);
  $("target").textContent = config.email;
  showQuick(Boolean(quick?.totp), Boolean(quick?.passkey));
}

const standaloneUnlock = {
  async password(value) {
    const cache = (await local.get(CACHE_KEY))[CACHE_KEY];
    await storeSession(await unlockCachedVault(config, cache, value));
  },
  async code(value) {
    let result;
    try {
      result = await unlockWithTotp(config, quick.totp, value);
    } catch (error) {
      if (isQuickUnlockGone(error)) await writeQuickUnlock(config, { totp: null });
      throw error;
    }
    try {
      await storeSession(bytesToBase64(result.rawKey), result.token);
    } finally {
      result.rawKey.fill(0);
    }
  },
  async passkey() {
    const secret = await passkeySecret(quick.passkey);
    let rawKey;
    try {
      rawKey = await unlockWithPasskeySecret(config, quick.passkey, secret);
    } finally {
      secret.fill(0);
    }
    try {
      await storeSession(bytesToBase64(rawKey));
    } finally {
      rawKey.fill(0);
    }
  },
};

/* ----------------------------- setup mode ------------------------------ */

async function initSetup() {
  $("title").textContent = "Set up passkey unlock";
  $("unlock-form").hidden = true;
  $("setup").hidden = false;
  config = (await local.get(CONFIG_KEY))[CONFIG_KEY];
  const current = await session.get();
  if (!config?.keyCheck || !current?.encryptionKeyB64 || !isSessionFresh(current) ||
      (await keyCheck(base64ToBytes(current.encryptionKeyB64))) !== config.keyCheck) {
    $("setup-passkey").disabled = true;
    throw new Error("Unlock your vault in the extension first, then try again.");
  }
  $("target").textContent = config.email;
  $("setup-passkey").addEventListener("click", (event) => {
    if (!event.isTrusted) return;
    const button = $("setup-passkey");
    void attempt("Waiting for passkey…", button, async () => {
      const latest = await session.get();
      if (!latest?.encryptionKeyB64 || !isSessionFresh(latest)) {
        throw new Error("The vault locked. Unlock it and try again.");
      }
      const rawKey = base64ToBytes(latest.encryptionKeyB64);
      try {
        const passkey = await createPasskey(config, rawKey);
        await writeQuickUnlock(config, { passkey });
      } finally {
        rawKey.fill(0);
      }
      button.disabled = true;
      status.classList.add("ok");
      status.textContent = "Passkey ready. Use it next time you unlock.";
      setTimeout(() => window.close(), 1400);
    });
  });
}

/* ------------------------------- wiring -------------------------------- */

const handlers = mode === "unlock" ? standaloneUnlock : formUnlock;
const success = mode === "unlock"
  ? "Unlocked. Open FlexiVault from the toolbar."
  : "Unlocked. Choose a saved login on the form.";

try {
  if (mode === "passkey-setup") {
    await initSetup();
  } else {
    if (mode === "unlock") await initStandalone();
    else await initForm();
    setEnabled(true);
    if (!$("code-form").hidden) code.focus();
    else password.focus();
  }
} catch (error) {
  status.textContent = error.message;
}

$("unlock-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.isTrusted || password.disabled) return;
  const value = password.value;
  void attempt("Unlocking…", unlock, async () => {
    await handlers.password(value);
    done(success);
  });
});

$("code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (!event.isTrusted || code.disabled) return;
  const value = code.value;
  void attempt("Checking…", codeSubmit, async () => {
    await handlers.code(value);
    done(success);
  });
});

passkeyButton.addEventListener("click", (event) => {
  if (!event.isTrusted || passkeyButton.disabled) return;
  void attempt("Waiting for passkey…", passkeyButton, async () => {
    await handlers.passkey();
    done(success);
  });
});

async function cancel() {
  cancelled = true;
  password.value = "";
  code.value = "";
  setEnabled(false);
  if (mode === "form") {
    await send("flexivault:unlock-cancel").catch((error) => { status.textContent = error.message; });
  }
  window.close();
}
$("cancel").addEventListener("click", (event) => {
  if (event.isTrusted) void cancel();
});
document.addEventListener("keydown", (event) => {
  if (event.isTrusted && event.key === "Escape") {
    event.preventDefault();
    void cancel();
  }
});
