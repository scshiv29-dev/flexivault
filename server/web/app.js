/*
 * FlexiVault web vault. Everything is decrypted in this browser: the master
 * password and vault key never leave it, the server only sees the same
 * authHash and AES-GCM envelopes the mobile app and extension send.
 *
 * Item format, crypto and sync rules match lib/vault (types.ts, crypto.ts,
 * sync.ts): items merge by `updatedAt`, deletions are tombstones
 * (`deletedAt`), and pushes carry the last seen revision.
 */
import {
  KDF_ITERATIONS,
  decryptItem,
  deriveKeys,
  encryptItem,
  importVaultKey,
  newItemId,
  randomBase64,
} from "./crypto.js";
import { formatTotpCode, generateTotp, isValidBase32, normaliseBase32, secondsRemaining } from "./otp.js";
import { encodeQr } from "./qr.js";

const AUTO_LOCK_MS = 15 * 60 * 1000;
const TYPES = [
  ["all", "All"],
  ["login", "Logins"],
  ["totp", "2FA codes"],
  ["note", "Notes"],
  ["card", "Cards"],
  ["identity", "Identities"],
];
const TYPE_LABEL = { login: "Login", totp: "2FA code", note: "Note", card: "Card", identity: "Identity" };

const state = {
  info: null,
  session: null, // { email, token, isAdmin, totpEnabled }
  key: null,
  revision: 0,
  items: [],
  unreadable: [], // rows we could not decrypt; always pushed back unchanged
  filters: { q: "", type: "all", domain: "", account: "", local: false, favorites: false },
  selectedId: null,
  editing: null, // item draft being edited, or null
  lastActive: Date.now(),
  busy: false,
};

const app = document.getElementById("app");

/* ------------------------------------------------------------------ DOM */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") {
      el.addEventListener(name.slice(2).toLowerCase(), value);
    } else if (name === "class") {
      el.className = value;
    } else if (name === "value") {
      el.value = value;
    } else if (value === true) {
      el.setAttribute(name, "");
    } else {
      el.setAttribute(name, String(value));
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function mount(...nodes) {
  app.replaceChildren(...nodes);
}

let toastTimer;
function toast(message, tone = "") {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.className = `toast show ${tone}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = "toast"), 2600);
}

async function copy(text, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast("Copy failed: your browser blocked clipboard access", "danger");
  }
}

function qrSvg(text, size = 240) {
  const modules = encodeQr(text);
  const n = modules.length + 8;
  let d = "";
  modules.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x + 4} ${y + 4}h1v1h-1z`)));
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${n} ${n}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code");
  svg.setAttribute("shape-rendering", "crispEdges");
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("width", String(n));
  rect.setAttribute("height", String(n));
  rect.setAttribute("fill", "#fff");
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.append(rect, path);
  return h("div", { class: "qr" }, svg);
}

function brand() {
  return h("div", { class: "brand" }, h("span", { class: "brand-mark", "aria-hidden": "true" }, "F"), state.info?.name ?? "FlexiVault");
}

function field(label, input, hint) {
  return h("label", { class: "field" }, h("span", {}, label), input, hint ? h("div", { class: "hint" }, hint) : null);
}

function formError(message) {
  return message ? h("div", { class: "callout danger", role: "alert" }, message) : null;
}

/* ------------------------------------------------------------------ API */

class ApiError extends Error {
  constructor(message, status, code, data = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function api(path, { method = "GET", body, auth = true } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(auth && state.session?.token ? { Authorization: `Bearer ${state.session.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Could not reach the server.", 0, "network_error");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && auth && state.session && payload.code === "unauthorized") {
      lock("Your session expired. Sign in again.");
    }
    throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status, payload.code ?? "request_failed", payload);
  }
  return payload;
}

/* ---------------------------------------------------------------- vault */

function mergeItems(local, remote) {
  const byId = new Map();
  for (const item of local) byId.set(item.id, item);
  for (const item of remote) {
    const existing = byId.get(item.id);
    if (!existing || Number(item.updatedAt) > Number(existing.updatedAt)) byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
}

async function decryptRows(rows) {
  const items = [];
  const unreadable = [];
  for (const row of rows) {
    try {
      items.push(await decryptItem(state.key, row.data));
    } catch {
      unreadable.push(row);
    }
  }
  return { items, unreadable };
}

async function pull() {
  const remote = await api("/api/sync");
  const { items, unreadable } = await decryptRows(remote.items ?? []);
  if (items.length === 0 && unreadable.length > 0) {
    throw new Error("This vault was encrypted with a different master password.");
  }
  state.items = mergeItems([], items);
  state.unreadable = unreadable;
  state.revision = Number(remote.revision ?? 0);
}

/** Saves one changed item, merging with other devices' writes on conflict. */
async function saveItem(changed) {
  let items = mergeItems(state.items.filter((item) => item.id !== changed.id), [changed]);
  let unreadable = state.unreadable;
  let baseRevision = state.revision;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await Promise.all(
      items.map(async (item) => ({ id: item.id, data: await encryptItem(state.key, item), updatedAt: item.updatedAt }))
    );
    const unreadableIds = new Set(items.map((item) => item.id));
    const passthrough = unreadable.filter((row) => !unreadableIds.has(row.id));
    try {
      const result = await api("/api/sync", {
        method: "PUT",
        body: { baseRevision, items: [...rows, ...passthrough] },
      });
      state.items = items;
      state.unreadable = passthrough;
      state.revision = Number(result.revision);
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === "revision_mismatch" && Array.isArray(error.data.items)) {
        const remote = await decryptRows(error.data.items);
        items = mergeItems(items, remote.items);
        // Our edit wins over an older copy of the same item.
        items = mergeItems(items.filter((item) => item.id !== changed.id), [changed]);
        unreadable = remote.unreadable;
        baseRevision = Number(error.data.revision ?? baseRevision);
        continue;
      }
      throw error;
    }
  }
  throw new Error("The vault kept changing on another device. Try again.");
}

function visibleItems() {
  return state.items.filter((item) => !item.deletedAt);
}

/* -------------------------------------------------------------- filters */

const LOCAL_SUFFIXES = [".local", ".lan", ".home", ".home.arpa", ".internal", ".localhost", ".localdomain", ".intranet", ".corp"];

function hostOf(url) {
  const text = String(url ?? "").trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:/i.test(text)) return null; // androidapp://, etc.
  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "") || null;
  } catch {
    return null;
  }
}

function isIp(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function isLocalHost(host) {
  if (!host) return false;
  if (host === "localhost" || !host.includes(".") && !host.includes(":")) return true;
  if (LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return host === "::1" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
}

const TWO_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or", "gen", "firm", "ltd", "plc"]);

/** example.com for login.example.com; IPs and local names stay as they are. */
function baseDomain(host) {
  if (!host || isIp(host) || isLocalHost(host)) return host;
  const parts = host.replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const take = parts.at(-1).length === 2 && TWO_LEVEL.has(parts.at(-2)) ? 3 : 2;
  return parts.slice(-take).join(".");
}

function itemHosts(item) {
  return (item.urls ?? []).map(hostOf).filter(Boolean);
}

function itemAccounts(item) {
  return [item.username, item.identity?.email].map((v) => String(v ?? "").trim()).filter(Boolean);
}

function itemType(item) {
  return item.type ?? "login";
}

function matchesType(item, type) {
  if (type === "all") return true;
  if (type === "totp") return itemType(item) === "totp" || Boolean(item.totp?.secret);
  return itemType(item) === type;
}

function filteredItems() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  return visibleItems().filter((item) => {
    if (!matchesType(item, f.type)) return false;
    if (f.favorites && !item.favorite) return false;
    const hosts = itemHosts(item);
    if (f.local && !hosts.some(isLocalHost)) return false;
    if (f.domain && !hosts.some((host) => baseDomain(host) === f.domain)) return false;
    if (f.account && !itemAccounts(item).some((a) => a.toLowerCase() === f.account)) return false;
    if (!q) return true;
    const haystack = [item.name, item.username, item.notes, item.folder, item.identity?.email, item.card?.holder, ...(item.urls ?? [])]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

function facetCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ------------------------------------------------------------- session */

function touch() {
  state.lastActive = Date.now();
}
["click", "keydown", "pointermove"].forEach((name) => window.addEventListener(name, touch, { passive: true }));
setInterval(() => {
  if (state.key && Date.now() - state.lastActive > AUTO_LOCK_MS) lock("Locked after 15 minutes without activity.");
}, 15_000);

function lock(message) {
  state.session = null;
  state.key = null;
  state.items = [];
  state.unreadable = [];
  state.selectedId = null;
  state.editing = null;
  state.revision = 0;
  adminState.data = null;
  adminState.created = null;
  closeModal();
  if (message) toast(message);
  if (route().name !== "join") location.hash = "#/";
  render();
}

async function signIn({ email, password, totpCode }) {
  const pre = await api("/api/accounts/prelogin", { method: "POST", body: { email }, auth: false });
  const keys = await deriveKeys(password, pre.kdfSalt, pre.kdfIterations);
  const auth = await api("/api/accounts/login", {
    method: "POST",
    auth: false,
    body: { email, authHash: keys.authHash, totpCode: totpCode || undefined },
  });
  await startSession(auth, keys.encryptionKey);
}

async function startSession(auth, rawKey) {
  state.session = { email: auth.email, token: auth.token, isAdmin: Boolean(auth.isAdmin), totpEnabled: auth.totpEnabled };
  state.key = await importVaultKey(rawKey);
  rawKey.fill?.(0);
  await pull();
  touch();
}

/* ------------------------------------------------------------- routing */

function route() {
  const hash = location.hash.replace(/^#/, "");
  const join = hash.match(/^\/join\/([A-Za-z0-9_-]+)$/);
  if (join) return { name: "join", token: join[1] };
  if (hash === "/signup") return { name: "join", token: null };
  if (hash === "/admin") return { name: "admin" };
  if (hash === "/welcome") return { name: "welcome" };
  return { name: state.session ? "vault" : "login" };
}

window.addEventListener("hashchange", () => render());

function render() {
  const r = route();
  if (r.name === "join") return renderJoin(r.token);
  if (!state.session) return renderLogin();
  if (r.name === "admin") return state.session.isAdmin ? renderAdmin() : renderVault();
  if (r.name === "welcome") return renderWelcome();
  return renderVault();
}

/* --------------------------------------------------------------- login */

function renderLogin(error = null, values = {}) {
  const email = h("input", { type: "email", name: "email", autocomplete: "username", required: true, value: values.email ?? "" });
  const password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const totp = h("input", { type: "text", name: "totp", inputmode: "numeric", autocomplete: "one-time-code", maxlength: 6, placeholder: "6-digit code" });
  const needsTotp = Boolean(values.needsTotp);
  const submit = h("button", { class: "btn primary block", type: "submit" }, "Unlock vault");

  const form = h(
    "form",
    {
      class: "card stack",
      onsubmit: async (event) => {
        event.preventDefault();
        submit.disabled = true;
        submit.textContent = "Unlocking…";
        try {
          await signIn({ email: email.value.trim().toLowerCase(), password: password.value, totpCode: totp.value.trim() });
          location.hash = "#/";
          render();
        } catch (caught) {
          const totpNeeded = caught.code === "totp_required" || caught.code === "invalid_totp";
          renderLogin(caught.code === "totp_required" ? null : caught.message, { email: email.value, needsTotp: needsTotp || totpNeeded });
        }
      },
    },
    field("Email", email),
    field("Master password", password, "Decrypts your vault in this browser. It is never sent to the server."),
    needsTotp ? field("Two-factor code", totp) : null,
    formError(error),
    submit
  );

  mount(
    h(
      "main",
      { class: "narrow" },
      brand(),
      h("h1", {}, "Unlock your vault"),
      h("p", { class: "muted" }, "Sign in with the email and master password you use in the FlexiVault app."),
      form,
      h(
        "div",
        { class: "card small muted" },
        "New here? Open the invite link the server admin sent you. ",
        state.info?.registrationOpen ? "Sign-up is open: " : "Server admin, or on the home network? ",
        h("a", { href: "#/signup" }, "Create an account"),
        "."
      )
    )
  );
  (needsTotp ? totp : values.email ? password : email).focus();
}

/* ---------------------------------------------------------------- join */

async function renderJoin(token) {
  mount(h("main", { class: "narrow" }, brand(), h("p", { class: "boot" }, "Checking your invite…")));
  let invite;
  try {
    // Without a link the server's sign-up rules decide (open sign-up, local
    // network, admin emails, or a typed invite code).
    invite = token
      ? await api(`/api/invites/${encodeURIComponent(token)}`, { auth: false })
      : { serverName: state.info?.name ?? "FlexiVault", email: null, domains: [] };
  } catch (caught) {
    mount(
      h(
        "main",
        { class: "narrow" },
        brand(),
        h("h1", {}, "Invite not valid"),
        h("p", { class: "muted" }, caught.message),
        h("p", {}, "Ask the server admin for a new link, or ", h("a", { href: "#/" }, "sign in"), " if you already have an account.")
      )
    );
    return;
  }

  const email = h("input", {
    type: "email",
    autocomplete: "username",
    required: true,
    value: invite.email ?? "",
    readonly: Boolean(invite.email),
  });
  const password = h("input", { type: "password", autocomplete: "new-password", required: true, minlength: 10 });
  const confirm = h("input", { type: "password", autocomplete: "new-password", required: true });
  const ack = h("input", { type: "checkbox", required: true });
  const code = h("input", { type: "text", autocomplete: "off", placeholder: "Only if the admin gave you one" });
  const errorSlot = h("div");
  const submit = h("button", { class: "btn primary block", type: "submit" }, "Create my vault");

  const form = h(
    "form",
    {
      class: "card stack",
      onsubmit: async (event) => {
        event.preventDefault();
        errorSlot.replaceChildren();
        const address = email.value.trim().toLowerCase();
        if (password.value.length < 10) return errorSlot.append(formError("Use at least 10 characters. Longer is stronger."));
        if (password.value !== confirm.value) return errorSlot.append(formError("The two passwords do not match."));
        submit.disabled = true;
        submit.textContent = "Creating…";
        try {
          const kdfSalt = randomBase64(16);
          const keys = await deriveKeys(password.value, kdfSalt, KDF_ITERATIONS);
          const auth = await api("/api/accounts/register", {
            method: "POST",
            auth: false,
            body: {
              email: address,
              authHash: keys.authHash,
              kdfSalt,
              kdfIterations: KDF_ITERATIONS,
              inviteCode: token ?? (code.value.trim() || undefined),
            },
          });
          await startSession(auth, keys.encryptionKey);
          location.hash = "#/welcome";
        } catch (caught) {
          submit.disabled = false;
          submit.textContent = "Create my vault";
          errorSlot.append(formError(caught.message));
        }
      },
    },
    field(
      "Email",
      email,
      invite.email
        ? "This invite is for this address."
        : invite.domains?.length
          ? `Use an address at ${invite.domains.join(", ")}.`
          : null
    ),
    field("Master password", password, "At least 10 characters. A few random words work well."),
    field("Confirm master password", confirm),
    token ? null : field("Invite code", code),
    h(
      "label",
      { class: "check small" },
      ack,
      h("span", {}, "I understand nobody can reset this password, not even the server admin. If I forget it, my vault is gone.")
    ),
    errorSlot,
    submit
  );

  mount(
    h(
      "main",
      { class: "narrow" },
      brand(),
      h("h1", {}, token ? `Join ${invite.serverName}` : "Create an account"),
      h("p", { class: "muted" }, "Create your own private vault. It is encrypted in this browser before anything is sent to the server."),
      form
    )
  );
  (invite.email ? password : email).focus();
}

/* ------------------------------------------------------- phone connect */

function connectLink() {
  const params = new URLSearchParams({ server: location.origin, email: state.session.email });
  return `flexivault://connect?${params}`;
}

function phonePanel() {
  return h(
    "div",
    { class: "stack" },
    qrSvg(connectLink(), 240),
    h(
      "ol",
      { class: "steps small" },
      h("li", {}, "Install FlexiVault on your phone and open it."),
      h("li", {}, "Tap ", h("strong", {}, "Sign in to a server"), ", then ", h("strong", {}, "Scan QR code"), ", and scan this code. On Android the camera app works too."),
      h("li", {}, "Type your master password on the phone. The code never contains it.")
    ),
    h("div", { class: "small muted" }, "Or fill in the sign-in screen by hand:"),
    h("div", { class: "copybox" }, h("code", {}, location.origin), h("button", { class: "btn small", type: "button", onclick: () => copy(location.origin, "Server address") }, "Copy")),
    h("div", { class: "copybox" }, h("code", {}, state.session.email), h("button", { class: "btn small", type: "button", onclick: () => copy(state.session.email, "Email") }, "Copy")),
    h(
      "a",
      { class: "btn block", href: connectLink() },
      "On your phone? Open in the FlexiVault app"
    ),
    h(
      "div",
      { class: "callout warn small" },
      "Already have a vault on the phone? Use Settings → Server → Scan QR code there. If that phone's vault was made with a different master password, the app asks before replacing it with this one."
    )
  );
}

function renderWelcome() {
  mount(
    h(
      "main",
      { class: "narrow" },
      brand(),
      h("h1", {}, "Your vault is ready"),
      h("p", { class: "muted" }, `Signed in as ${state.session.email}. Set up your phone now, or go straight to your vault.`),
      h("div", { class: "card" }, h("h2", {}, "Connect your phone"), h("p", { class: "muted small" }, "Scan with the FlexiVault app to sync this vault."), phonePanel()),
      h("div", { class: "card" }, h("a", { class: "btn primary block", href: "#/" }, "Open my vault"))
    )
  );
}

let modalNode = null;
function openModal(title, body) {
  closeModal();
  modalNode = h(
    "div",
    {
      class: "modal-backdrop",
      onclick: (event) => event.target === modalNode && closeModal(),
    },
    h(
      "div",
      { class: "card modal", role: "dialog", "aria-modal": "true", "aria-label": title },
      h("div", { class: "row" }, h("h2", { class: "grow" }, title), h("button", { class: "btn ghost small", type: "button", onclick: closeModal }, "Close")),
      body
    )
  );
  document.body.append(modalNode);
}
function closeModal() {
  modalNode?.remove();
  modalNode = null;
}
window.addEventListener("keydown", (event) => event.key === "Escape" && closeModal());

/* --------------------------------------------------------------- vault */

function topbar(active) {
  return h(
    "header",
    { class: "topbar" },
    brand(),
    h("span", { class: "who" }, state.session.email),
    h("span", { class: "spacer" }),
    active === "admin"
      ? h("a", { class: "btn small", href: "#/" }, "Vault")
      : state.session.isAdmin
        ? h("a", { class: "btn small", href: "#/admin" }, "Admin")
        : null,
    h("button", { class: "btn small", type: "button", onclick: () => openModal("Connect a phone", phonePanel()) }, "Connect a phone"),
    active === "vault"
      ? h(
          "button",
          {
            class: "btn small",
            type: "button",
            onclick: async (event) => {
              event.currentTarget.disabled = true;
              try {
                await pull();
                toast("Vault synced");
              } catch (caught) {
                toast(caught.message, "danger");
              }
              render();
            },
          },
          "Sync"
        )
      : null,
    h("button", { class: "btn small", type: "button", onclick: () => lock("Vault locked") }, "Lock")
  );
}

function chip(label, pressed, onclick, count) {
  return h("button", { class: "chip", type: "button", "aria-pressed": String(pressed), onclick }, label, count !== undefined ? h("span", { class: "count" }, count) : null);
}

function setFilter(patch) {
  Object.assign(state.filters, patch);
  render();
}

function filtersPanel() {
  const items = visibleItems();
  const f = state.filters;
  const domains = facetCounts(items.flatMap((item) => [...new Set(itemHosts(item).map(baseDomain))]));
  const accounts = facetCounts(items.flatMap((item) => [...new Set(itemAccounts(item).map((a) => a.toLowerCase()))]));
  const localCount = items.filter((item) => itemHosts(item).some(isLocalHost)).length;

  const search = h("input", {
    type: "search",
    placeholder: "Search name, user, URL, notes",
    "aria-label": "Search vault",
    value: f.q,
    oninput: (event) => {
      state.filters.q = event.target.value;
      renderListOnly();
    },
  });

  const domainSelect = h(
    "select",
    { "aria-label": "Filter by domain", onchange: (event) => setFilter({ domain: event.target.value }) },
    h("option", { value: "" }, `All domains (${domains.length})`),
    domains.map(([domain, count]) => h("option", { value: domain, selected: domain === f.domain }, `${domain} (${count})`))
  );
  const accountSelect = h(
    "select",
    { "aria-label": "Filter by email or username", onchange: (event) => setFilter({ account: event.target.value }) },
    h("option", { value: "" }, `All accounts (${accounts.length})`),
    accounts
      .sort((a, b) => Number(b[0].includes("@")) - Number(a[0].includes("@")) || b[1] - a[1])
      .map(([account, count]) => h("option", { value: account, selected: account === f.account }, `${account} (${count})`))
  );
  const active = f.type !== "all" || f.domain || f.account || f.local || f.favorites || f.q;

  return h(
    "aside",
    { class: "card filters" },
    h("div", { class: "group" }, search),
    h(
      "div",
      { class: "group" },
      h("div", { class: "group-title" }, "Type"),
      h("div", { class: "chips" }, TYPES.map(([key, label]) => chip(label, f.type === key, () => setFilter({ type: key }), items.filter((item) => matchesType(item, key)).length)))
    ),
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Domain"), domainSelect),
    h("div", { class: "group" }, h("div", { class: "group-title" }, "Email / username"), accountSelect),
    h(
      "div",
      { class: "group" },
      h("div", { class: "group-title" }, "Show only"),
      h(
        "div",
        { class: "chips" },
        chip("Localhost & LAN", f.local, () => setFilter({ local: !f.local }), localCount),
        chip("Favorites", f.favorites, () => setFilter({ favorites: !f.favorites }), items.filter((item) => item.favorite).length)
      ),
      h("div", { class: "hint" }, "Localhost & LAN: localhost, private IPs, and names like router.lan or nas.local.")
    ),
    active
      ? h(
          "div",
          { class: "group" },
          h("button", { class: "btn small block", type: "button", onclick: () => setFilter({ q: "", type: "all", domain: "", account: "", local: false, favorites: false }) }, "Clear filters")
        )
      : null
  );
}

function avatarFor(item) {
  const letter = (item.name ?? "?").trim().charAt(0) || "?";
  return h("span", { class: "avatar", "aria-hidden": "true" }, letter);
}

function subtitle(item) {
  const type = itemType(item);
  if (type === "card") return item.card?.number ? `•••• ${String(item.card.number).replace(/\s/g, "").slice(-4)}` : "Card";
  if (type === "identity") return item.identity?.email || item.identity?.fullName || "Identity";
  if (type === "note") return (item.notes ?? "").split("\n")[0].slice(0, 80) || "Note";
  const host = itemHosts(item)[0];
  return [item.username, host].filter(Boolean).join(" · ") || TYPE_LABEL[type] || "";
}

function listPanel() {
  const items = filteredItems();
  return h(
    "section",
    { class: "card list", id: "list" },
    h(
      "div",
      { class: "list-head" },
      h("strong", {}, `${items.length} item${items.length === 1 ? "" : "s"}`),
      h("button", { class: "btn primary small", type: "button", onclick: () => startEdit(null) }, "+ New item")
    ),
    items.length === 0
      ? h("div", { class: "empty" }, visibleItems().length === 0 ? "Your vault is empty. Add an item, or import into the mobile app." : "Nothing matches these filters.")
      : items.map((item) =>
          h(
            "button",
            {
              class: "item",
              type: "button",
              "aria-current": String(item.id === state.selectedId),
              onclick: () => {
                state.selectedId = item.id;
                state.editing = null;
                render();
              },
            },
            avatarFor(item),
            h("span", { class: "text" }, h("div", { class: "name" }, item.favorite ? "★ " : "", item.name || "Untitled"), h("div", { class: "sub" }, subtitle(item))),
            item.totp?.secret && itemType(item) !== "totp" ? h("span", { class: "tag" }, "2FA") : null
          )
        )
  );
}

function renderListOnly() {
  const current = document.getElementById("list");
  if (current) current.replaceWith(listPanel());
}

function secretRow(label, value, what) {
  if (!value) return null;
  const text = h("span", { class: "v mono" }, "••••••••••");
  let shown = false;
  return h(
    "div",
    { class: "kv" },
    h("div", { class: "grow" }, h("div", { class: "k" }, label), text),
    h(
      "button",
      {
        class: "btn icon-btn",
        type: "button",
        onclick: (event) => {
          shown = !shown;
          text.textContent = shown ? value : "••••••••••";
          event.currentTarget.textContent = shown ? "Hide" : "Show";
        },
      },
      "Show"
    ),
    h("button", { class: "btn icon-btn", type: "button", onclick: () => copy(value, what) }, "Copy")
  );
}

function plainRow(label, value, what) {
  if (!value) return null;
  return h(
    "div",
    { class: "kv" },
    h("div", { class: "grow" }, h("div", { class: "k" }, label), h("div", { class: "v" }, value)),
    what ? h("button", { class: "btn icon-btn", type: "button", onclick: () => copy(String(value), what) }, "Copy") : null
  );
}

function totpRow(config) {
  if (!config?.secret) return null;
  const code = h("span", { class: "totp mono", "data-totp": "1" }, "······");
  const remaining = h("span", { class: "small muted" });
  let current = "";
  const update = async () => {
    try {
      current = await generateTotp(config);
      code.textContent = formatTotpCode(current);
      remaining.textContent = `${secondsRemaining(config.period || 30)}s`;
    } catch {
      code.textContent = "Invalid secret";
    }
  };
  update();
  const timer = setInterval(() => (code.isConnected ? update() : clearInterval(timer)), 1000);
  return h(
    "div",
    { class: "kv" },
    h("div", { class: "grow" }, h("div", { class: "k" }, "Two-factor code"), h("div", { class: "row" }, code, remaining)),
    h("button", { class: "btn icon-btn", type: "button", onclick: () => current && copy(current, "Code") }, "Copy")
  );
}

function urlRows(item) {
  return (item.urls ?? []).filter(Boolean).map((url) => {
    const safe = /^https?:\/\//i.test(url) ? url : hostOf(url) ? `https://${url}` : null;
    return h(
      "div",
      { class: "kv" },
      h("div", { class: "grow" }, h("div", { class: "k" }, "Website"), safe ? h("a", { class: "v", href: safe, target: "_blank", rel: "noopener noreferrer" }, url) : h("div", { class: "v" }, url)),
      h("button", { class: "btn icon-btn", type: "button", onclick: () => copy(url, "URL") }, "Copy")
    );
  });
}

function detailPanel() {
  if (state.editing) return editPanel();
  const item = visibleItems().find((candidate) => candidate.id === state.selectedId);
  if (!item) {
    return h("section", { class: "card detail" }, h("div", { class: "empty" }, "Select an item to see its details."));
  }
  const type = itemType(item);
  return h(
    "section",
    { class: "card detail" },
    h(
      "div",
      { class: "head" },
      avatarFor(item),
      h("div", { class: "grow" }, h("h2", {}, item.name || "Untitled"), h("span", { class: "tag" }, TYPE_LABEL[type] ?? type), item.folder ? h("span", { class: "small muted" }, `  ${item.folder}`) : null)
    ),
    plainRow("Username", item.username, "Username"),
    secretRow("Password", item.password, "Password"),
    totpRow(item.totp),
    urlRows(item),
    type === "card"
      ? [
          plainRow("Cardholder", item.card?.holder, "Name"),
          secretRow("Number", item.card?.number, "Card number"),
          plainRow("Expiry", item.card?.expiry, "Expiry"),
          secretRow("Security code", item.card?.cvv, "Security code"),
        ]
      : null,
    type === "identity"
      ? [
          plainRow("Full name", item.identity?.fullName, "Name"),
          plainRow("Email", item.identity?.email, "Email"),
          plainRow("Phone", item.identity?.phone, "Phone"),
          plainRow("Address", item.identity?.address, "Address"),
          plainRow("Company", item.identity?.company, "Company"),
          secretRow("Passport", item.identity?.passport, "Passport"),
        ]
      : null,
    item.passkey ? plainRow("Passkey", `${item.passkey.rpId} · ${item.passkey.userName}`) : null,
    item.notes ? h("div", { class: "kv" }, h("div", { class: "grow" }, h("div", { class: "k" }, "Notes"), h("div", { class: "v notes" }, item.notes))) : null,
    h("div", { class: "kv small muted" }, `Updated ${new Date(Number(item.updatedAt)).toLocaleString()}`),
    h(
      "div",
      { class: "row mt12" },
      h("button", { class: "btn", type: "button", onclick: () => startEdit(item) }, "Edit"),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: async () => {
            await runSave({ ...item, favorite: !item.favorite, updatedAt: Date.now() }, item.favorite ? "Removed from favorites" : "Added to favorites");
          },
        },
        item.favorite ? "Unfavorite" : "Favorite"
      ),
      h("span", { class: "spacer grow" }),
      h(
        "button",
        {
          class: "btn danger",
          type: "button",
          onclick: async () => {
            if (!confirm(`Delete "${item.name}"? It is removed from all your devices.`)) return;
            const now = Date.now();
            state.selectedId = null;
            await runSave({ ...item, deletedAt: now, updatedAt: now }, "Item deleted");
          },
        },
        "Delete"
      )
    )
  );
}

async function runSave(item, message) {
  if (state.busy) return false;
  state.busy = true;
  try {
    await saveItem(item);
    toast(message);
    return true;
  } catch (caught) {
    toast(caught.message, "danger");
    return false;
  } finally {
    state.busy = false;
    render();
  }
}

function startEdit(item) {
  state.editing = item ? structuredClone(item) : { id: null, type: "login", name: "", urls: [] };
  render();
}

function generatePassword(length = 20) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+";
  const limit = 256 - (256 % chars.length);
  let out = "";
  while (out.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out += chars[byte % chars.length];
    }
  }
  return out;
}

function editPanel() {
  const draft = state.editing;
  const isNew = !draft.id;
  const type = draft.type ?? "login";
  const inputs = {};
  const text = (name, value, attrs = {}) => (inputs[name] = h("input", { type: "text", value: value ?? "", ...attrs }));
  const area = (name, value) => {
    const el = h("textarea", {});
    el.value = value ?? "";
    return (inputs[name] = el);
  };
  const errorSlot = h("div");

  const typeSelect = h(
    "select",
    {
      disabled: !isNew,
      onchange: (event) => {
        state.editing = { ...collect(), type: event.target.value };
        render();
      },
    },
    TYPES.slice(1).map(([key]) => h("option", { value: key, selected: key === type }, TYPE_LABEL[key]))
  );

  const password = text("password", draft.password, { autocomplete: "off", class: "mono" });
  const fields = [];
  if (type === "login") {
    fields.push(
      field("Username or email", text("username", draft.username, { autocomplete: "off" })),
      field(
        "Password",
        h("div", { class: "row" }, h("div", { class: "grow" }, password), h("button", { class: "btn small", type: "button", onclick: () => (password.value = generatePassword()) }, "Generate"))
      ),
      field("Websites", area("urls", (draft.urls ?? []).join("\n")), "One per line, e.g. github.com or http://192.168.1.1"),
      field("Two-factor secret (optional)", text("totpSecret", draft.totp?.secret, { autocomplete: "off", class: "mono" }), "The base32 key a site shows under \"enter this key manually\".")
    );
  }
  if (type === "totp") {
    fields.push(
      field("Secret key", text("totpSecret", draft.totp?.secret, { autocomplete: "off", class: "mono", required: true })),
      h("div", { class: "grid2" }, field("Issuer", text("issuer", draft.totp?.issuer)), field("Account", text("label", draft.totp?.label ?? draft.username)))
    );
  }
  if (type === "card") {
    fields.push(
      h("div", { class: "grid2" }, field("Cardholder", text("holder", draft.card?.holder)), field("Card number", text("number", draft.card?.number, { inputmode: "numeric", autocomplete: "off" }))),
      h("div", { class: "grid2" }, field("Expiry (MM/YY)", text("expiry", draft.card?.expiry)), field("Security code", text("cvv", draft.card?.cvv, { autocomplete: "off" })))
    );
  }
  if (type === "identity") {
    fields.push(
      h("div", { class: "grid2" }, field("Full name", text("fullName", draft.identity?.fullName)), field("Email", text("idEmail", draft.identity?.email))),
      h("div", { class: "grid2" }, field("Phone", text("phone", draft.identity?.phone)), field("Company", text("company", draft.identity?.company))),
      field("Address", area("address", draft.identity?.address)),
      field("Passport", text("passport", draft.identity?.passport, { autocomplete: "off" }))
    );
  }

  const opt = (value) => {
    const trimmed = String(value ?? "").trim();
    return trimmed || undefined;
  };

  function collect() {
    const value = (name) => inputs[name]?.value ?? "";
    const next = { ...draft, name: value("name").trim(), notes: value("notes"), folder: opt(value("folder")) };
    if (type === "login") {
      next.username = opt(value("username"));
      next.password = value("password") || undefined;
      next.urls = value("urls").split(/\n+/).map((v) => v.trim()).filter(Boolean);
    }
    if (type === "login" || type === "totp") {
      const secret = normaliseBase32(value("totpSecret"));
      const issuer = type === "totp" ? opt(value("issuer")) : draft.totp?.issuer;
      const label = type === "totp" ? opt(value("label")) : draft.totp?.label;
      next.totp = secret
        ? { algorithm: "SHA1", digits: 6, period: 30, ...(draft.totp ?? {}), secret, issuer, label }
        : null;
    }
    if (type === "card") {
      next.card = { ...(draft.card ?? {}), holder: opt(value("holder")), number: opt(value("number")), expiry: opt(value("expiry")), cvv: opt(value("cvv")) };
    }
    if (type === "identity") {
      next.identity = {
        ...(draft.identity ?? {}),
        fullName: opt(value("fullName")),
        email: opt(value("idEmail")),
        phone: opt(value("phone")),
        company: opt(value("company")),
        address: opt(value("address")),
        passport: opt(value("passport")),
      };
    }
    return next;
  }

  return h(
    "form",
    {
      class: "card detail stack",
      onsubmit: async (event) => {
        event.preventDefault();
        errorSlot.replaceChildren();
        const next = collect();
        if (!next.name) return errorSlot.append(formError("Give the item a name."));
        if (next.totp?.secret && !isValidBase32(next.totp.secret)) return errorSlot.append(formError("The two-factor secret is not a valid base32 key."));
        const now = Date.now();
        const item = {
          ...next,
          id: next.id ?? newItemId(),
          createdAt: next.createdAt ?? now,
          updatedAt: now,
          deletedAt: null,
          favorite: Boolean(next.favorite),
        };
        if (item.type === "login" && !item.androidPackages) item.androidPackages = [];
        const ok = await runSave(item, isNew ? "Item added" : "Item saved");
        if (ok) {
          state.editing = null;
          state.selectedId = item.id;
          render();
        }
      },
    },
    h("h2", {}, isNew ? "New item" : `Edit ${draft.name || "item"}`),
    field("Type", typeSelect),
    field("Name", text("name", draft.name, { required: true, maxlength: 200 })),
    fields,
    field("Notes", area("notes", draft.notes)),
    field("Folder (optional)", text("folder", draft.folder)),
    draft.passkey ? h("div", { class: "callout info small" }, "This item holds a passkey. It is kept unchanged; manage passkeys on your phone.") : null,
    errorSlot,
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn primary", type: "submit" }, isNew ? "Add item" : "Save"),
      h(
        "button",
        {
          class: "btn",
          type: "button",
          onclick: () => {
            state.editing = null;
            render();
          },
        },
        "Cancel"
      )
    )
  );
}

function renderVault() {
  const warning =
    state.unreadable.length > 0
      ? h("div", { class: "callout warn mb16" }, `${state.unreadable.length} item(s) could not be decrypted with this password. They are kept on the server unchanged.`)
      : null;
  mount(
    h(
      "main",
      { class: "wide" },
      topbar("vault"),
      warning,
      h("div", { class: "vault" }, filtersPanel(), listPanel(), h("div", { class: "detail-col" }, detailPanel()))
    )
  );
}

/* --------------------------------------------------------------- admin */

const adminState = { data: null, created: null, error: null };

async function loadAdmin() {
  adminState.data = await api("/api/admin/overview");
}

function fmtDate(ms) {
  return ms ? new Date(Number(ms)).toLocaleDateString() : "—";
}

function rulesCard(rules) {
  const open = h("input", { type: "checkbox", checked: rules.registrationOpen });
  const local = h("input", { type: "checkbox", checked: rules.allowLocal });
  const domains = h("textarea", { placeholder: "example.com\n*.company.org" });
  domains.value = (rules.allowedDomains ?? []).join("\n");
  const emails = h("textarea", { placeholder: "friend@gmail.com" });
  emails.value = (rules.allowedEmails ?? []).join("\n");
  const errorSlot = h("div");

  return h(
    "form",
    {
      class: "card stack",
      onsubmit: async (event) => {
        event.preventDefault();
        errorSlot.replaceChildren();
        try {
          await api("/api/admin/rules", {
            method: "PUT",
            body: { registrationOpen: open.checked, allowLocal: local.checked, allowedDomains: domains.value, allowedEmails: emails.value },
          });
          await loadAdmin();
          toast("Sign-up rules saved");
          renderAdmin();
        } catch (caught) {
          errorSlot.append(formError(caught.message));
        }
      },
    },
    h("h2", {}, "Who can sign up"),
    h("p", { class: "muted small" }, "Invite links always work, within their own email or domain limits. These rules cover everyone else."),
    h("label", { class: "check" }, open, h("span", {}, h("strong", {}, "Open sign-up"), h("div", { class: "hint" }, "Anyone who can reach this server can create an account (subject to the filters below)."))),
    h("label", { class: "check" }, local, h("span", {}, h("strong", {}, "Allow sign-up from localhost and the home network"), h("div", { class: "hint" }, "Requests from 127.0.0.1, 10.x, 172.16–31.x, 192.168.x and IPv6 local addresses can sign up without an invite. Behind a reverse proxy this needs TRUST_PROXY=true."))),
    h("div", { class: "grid2" }, field("Allowed email domains", domains, "One per line. Empty = any domain. *.example.com includes subdomains."), field("Allowed email addresses", emails, "One per line. Allowed even if their domain is not listed.")),
    errorSlot,
    h("div", {}, h("button", { class: "btn primary", type: "submit" }, "Save rules"))
  );
}

function inviteCard() {
  const email = h("input", { type: "email", placeholder: "Optional: lock to one person" });
  const domains = h("input", { type: "text", placeholder: "Optional: e.g. company.com" });
  const uses = h("input", { type: "number", min: 1, max: 100, value: 1 });
  const days = h("input", { type: "number", min: 1, max: 90, value: 7 });
  const note = h("input", { type: "text", placeholder: "Optional: who it's for", maxlength: 200 });
  const errorSlot = h("div");
  const created = adminState.created;

  return h(
    "div",
    { class: "card stack" },
    h("h2", {}, "Invite someone"),
    h("p", { class: "muted small" }, "Creates a private link. The person opens it, picks their master password, and gets a QR code to set up their phone."),
    h(
      "form",
      {
        class: "stack",
        onsubmit: async (event) => {
          event.preventDefault();
          errorSlot.replaceChildren();
          try {
            adminState.created = await api("/api/admin/invites", {
              method: "POST",
              body: { email: email.value.trim() || undefined, domains: domains.value, maxUses: Number(uses.value), expiresInDays: Number(days.value), note: note.value },
            });
            await loadAdmin();
            renderAdmin();
          } catch (caught) {
            errorSlot.append(formError(caught.message));
          }
        },
      },
      h("div", { class: "grid2" }, field("Email", email, "Only this address can use the link (single use)."), field("Email domains", domains, "Comma separated.")),
      h("div", { class: "grid2" }, field("Uses", uses, "Ignored when an email is set."), field("Expires after (days)", days)),
      field("Note", note),
      errorSlot,
      h("div", {}, h("button", { class: "btn primary", type: "submit" }, "Create invite link"))
    ),
    created
      ? h(
          "div",
          { class: "callout info stack" },
          h("strong", {}, "Invite link created. Copy it now: it is shown only once."),
          h("div", { class: "copybox" }, h("code", {}, created.url), h("button", { class: "btn small", type: "button", onclick: () => copy(created.url, "Invite link") }, "Copy")),
          h("div", { class: "small" }, "Or let them scan this with their phone camera:"),
          qrSvg(created.url, 200)
        )
      : null
  );
}

function invitesTable(invites) {
  if (!invites.length) return h("p", { class: "muted small" }, "No invite links yet.");
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ["For", "Uses", "Expires", "Status", ""].map((label) => h("th", {}, label)))),
      h(
        "tbody",
        {},
        invites.map((invite) =>
          h(
            "tr",
            {},
            h("td", {}, invite.email ?? (invite.domains.length ? `@${invite.domains.join(", @")}` : "Anyone"), invite.note ? h("div", { class: "small muted" }, invite.note) : null),
            h("td", {}, `${invite.uses}/${invite.maxUses}`),
            h("td", {}, fmtDate(invite.expiresAt)),
            h("td", {}, h("span", { class: `status ${invite.status}` }, invite.status)),
            h(
              "td",
              {},
              invite.status === "active"
                ? h(
                    "button",
                    {
                      class: "btn small danger",
                      type: "button",
                      onclick: async () => {
                        try {
                          await api(`/api/admin/invites/${invite.id}`, { method: "DELETE" });
                          await loadAdmin();
                          toast("Invite revoked");
                          renderAdmin();
                        } catch (caught) {
                          toast(caught.message, "danger");
                        }
                      },
                    },
                    "Revoke"
                  )
                : null
            )
          )
        )
      )
    )
  );
}

function usersTable(users) {
  return h(
    "div",
    { class: "table-wrap" },
    h(
      "table",
      {},
      h("thead", {}, h("tr", {}, ["Account", "Items", "2FA", "Joined", "Last change", ""].map((label) => h("th", {}, label)))),
      h(
        "tbody",
        {},
        users.map((user) =>
          h(
            "tr",
            {},
            h("td", {}, user.email, user.isAdmin ? h("span", { class: "tag ml6" }, "admin") : null),
            h("td", {}, user.records),
            h("td", {}, user.totpEnabled ? "On" : "Off"),
            h("td", {}, fmtDate(user.createdAt)),
            h("td", {}, fmtDate(user.updatedAt)),
            h(
              "td",
              {},
              user.email === state.session.email
                ? null
                : h(
                    "button",
                    {
                      class: "btn small danger",
                      type: "button",
                      onclick: async () => {
                        const typed = prompt(`This permanently deletes ${user.email} and their encrypted vault. Type the email to confirm.`);
                        if (typed?.trim().toLowerCase() !== user.email) return;
                        try {
                          await api(`/api/admin/users/${encodeURIComponent(user.email)}`, { method: "DELETE" });
                          await loadAdmin();
                          toast("Account deleted");
                          renderAdmin();
                        } catch (caught) {
                          toast(caught.message, "danger");
                        }
                      },
                    },
                    "Delete"
                  )
            )
          )
        )
      )
    ),
    h("p", { class: "hint" }, "Admins cannot see anyone's items. There is no password reset: a deleted or forgotten vault cannot be recovered.")
  );
}

async function renderAdmin() {
  if (!adminState.data) {
    mount(h("main", { class: "wide" }, topbar("admin"), h("p", { class: "boot" }, "Loading admin…")));
    try {
      await loadAdmin();
    } catch (caught) {
      mount(h("main", { class: "wide" }, topbar("admin"), formError(caught.message)));
      return;
    }
  }
  if (route().name !== "admin") return;
  const data = adminState.data;
  mount(
    h(
      "main",
      { class: "wide" },
      topbar("admin"),
      h("h1", {}, "Server admin"),
      h("p", { class: "muted" }, `${data.users.length} account${data.users.length === 1 ? "" : "s"} on this server.`),
      h("div", { class: "grid2 align-start" }, inviteCard(), h("div", { class: "card" }, h("h2", {}, "Invite links"), invitesTable(data.invites))),
      h("div", { class: "mt16" }, rulesCard(data.rules)),
      h("div", { class: "card mt16" }, h("h2", {}, "Accounts"), usersTable(data.users))
    )
  );
}

/* ---------------------------------------------------------------- boot */

(async () => {
  try {
    state.info = await api("/api/server-info", { auth: false });
    document.title = state.info.name ?? "FlexiVault";
  } catch {
    state.info = { name: "FlexiVault" };
  }
  render();
})();
