/* Popup view templates. All dynamic values are escaped. */

import {
  escapeHtml,
  hostOf,
  initialOf,
  itemSubtitle,
  lastFour,
  paletteFor,
  relativeTime,
  typeLabel,
} from "./presentation.js";

const BRAND = `<div class="brand"><span class="mark"></span>FlexiVault</div>`;

export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 5) return "Good night";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function syncLabel(state) {
  if (state.syncing) return "Syncing…";
  if (state.cache?.lastSyncedAt) {
    return `Synced ${relativeTime(state.cache.lastSyncedAt)}`;
  }
  return "Not synced yet";
}

function topbar(state) {
  const locked = state.view === "locked";
  const setup = state.view === "setup";
  const vault = state.view === "vault";

  const left = vault || setup || locked
    ? BRAND
    : `<button class="text-btn" data-action="back">← Vault</button>`;

  const actions = vault
    ? `${
        state.fullPage
          ? ""
          : `<button class="text-btn" data-action="open-vault" title="Open the full vault page">Full vault</button>`
      }
       <button class="text-btn" data-action="settings">Settings</button>
       <button class="text-btn accent" data-action="lock">Lock</button>`
    : locked
      ? `<button class="text-btn" data-action="setup">Server</button>`
      : setup
        ? ""
        : `<button class="text-btn accent" data-action="lock">Lock</button>`;

  return `<header class="topbar">${left}<div class="top-actions">${actions}</div></header>`;
}

function footer(state) {
  if (!["vault", "detail", "settings"].includes(state.view)) return "";
  return `<footer class="footer">
    <span class="tiny">${escapeHtml(hostOf(state.config?.serverUrl))} · end-to-end encrypted</span>
    <button class="text-btn accent" data-action="lock">Lock now</button>
  </footer>`;
}

function errorCallout(state, tone = "danger") {
  if (!state.error) return "";
  return `<div class="callout ${tone}"><div>${escapeHtml(state.error)}</div></div>`;
}

function setupBody(state) {
  const form = state.form;
  return `<main class="content">
    <div class="hero">
      <p class="eyebrow">Sync</p>
      <h1 class="display">Your vault,<br />your server.</h1>
      <p class="muted">Unlock the same end-to-end encrypted vault as the mobile app. The server
      only ever receives ciphertext.</p>
    </div>

    ${errorCallout(state)}

    ${state.config ? `<div class="callout warning"><div><strong>Already connected</strong>
      This browser is paired with ${escapeHtml(state.config.email)} on
      ${escapeHtml(hostOf(state.config.serverUrl))}. Connecting another account replaces it.</div></div>` : ""}

    <form data-form="connect">
      <div class="field">
        <label for="serverUrl">SERVER URL</label>
        <input id="serverUrl" data-field="serverUrl" type="url" autocapitalize="none"
          spellcheck="false" placeholder="https://vault.example.com"
          value="${escapeHtml(form.serverUrl)}" />
        <span class="hint">http:// is assumed for local addresses.</span>
      </div>

      <div class="field">
        <label for="email">EMAIL</label>
        <input id="email" data-field="email" type="email" autocapitalize="none"
          spellcheck="false" placeholder="you@example.com"
          value="${escapeHtml(form.email)}" />
      </div>

      <div class="field">
        <label for="password">MASTER PASSWORD</label>
        <input id="password" data-field="password" type="password"
          autocomplete="current-password" placeholder="The password that encrypts your vault"
          value="${escapeHtml(form.password)}" />
      </div>

      ${state.needsTotp ? `<div class="field">
        <label for="totp">TWO-FACTOR CODE</label>
        <input id="totp" data-field="totp" inputmode="numeric" maxlength="6"
          autocomplete="one-time-code" placeholder="6-digit code"
          value="${escapeHtml(form.totp)}" />
        <span class="hint">This account protects sign-in with an authenticator.</span>
      </div>` : ""}

      <button class="btn" type="submit" ${state.busy ? "disabled" : ""}>
        ${state.busy ? '<span class="spinner"></span>' : ""}
        ${state.busy ? "Deriving keys…" : "Connect and unlock"}
      </button>
      ${state.config ? `<button class="btn ghost" type="button" data-action="cancel-setup">Cancel</button>` : ""}
    </form>

    <div class="callout info" style="margin-top:14px">
      <div><strong>First time here?</strong>Create the vault in the FlexiVault mobile app, then
      add a server account under Settings → Server. The extension signs in to that account.</div>
    </div>

    <p class="tiny center" style="margin-top:12px">
      Your master password never leaves this popup. PBKDF2 stretches it locally;
      only an auth verifier reaches the server.
    </p>
  </main>`;
}

function lockedBody(state) {
  const initial = state.config?.email?.[0]?.toUpperCase() ?? "F";
  const cached = state.cache?.items?.length ?? 0;
  return `<main class="content">
    <div class="lock-hero">
      <div class="mark-large"></div>
      <h1 class="display small">Welcome back.</h1>
      <p class="muted center">${escapeHtml(state.config?.email ?? "")}<br />
      ${escapeHtml(hostOf(state.config?.serverUrl))}</p>
    </div>

    ${errorCallout(state)}

    <form data-form="unlock">
      <div class="field">
        <label for="password">MASTER PASSWORD</label>
        <input id="password" data-field="password" type="password" autofocus
          autocomplete="current-password" placeholder="Unlock your vault"
          value="${escapeHtml(state.form.password)}" />
      </div>

      ${state.needsTotp ? `<div class="field">
        <label for="totp">TWO-FACTOR CODE</label>
        <input id="totp" data-field="totp" inputmode="numeric" maxlength="6"
          autocomplete="one-time-code" placeholder="6-digit code"
          value="${escapeHtml(state.form.totp)}" />
      </div>` : ""}

      <button class="btn" type="submit" ${state.busy ? "disabled" : ""}>
        ${state.busy ? '<span class="spinner"></span>' : ""}
        ${state.busy ? "Unlocking…" : "Unlock vault"}
      </button>
    </form>

    <p class="tiny center" style="margin-top:13px">
      ${cached > 0 ? `${cached} encrypted items cached on this browser` : "No local cache yet"}
      · auto-locks after 15 minutes
    </p>

    <div class="center" style="margin-top:12px">
      <button class="link" data-action="setup">Use a different server</button>
    </div>

    <div class="callout" style="margin-top:22px">
      <div><strong>Unlock happens locally.</strong>${initial} · The AES key is derived in this
      popup with PBKDF2-SHA256 and kept in session storage only.</div>
    </div>
  </main>`;
}

function tile(item, size = "") {
  const [background, color] = paletteFor(item.name || item.id);
  return `<span class="tile ${size}" style="background:${background};color:${color}">${escapeHtml(
    initialOf(item.name)
  )}</span>`;
}

function chip(state, key, label, count) {
  return `<button class="chip ${state.filter === key ? "active" : ""}"
    data-action="filter" data-filter="${key}">${label}<span class="count">${count}</span></button>`;
}

function itemRow(item) {
  const badge = item.totp?.secret && item.type !== "totp"
    ? `<span class="badge">2FA</span>`
    : `<span class="chevron">›</span>`;
  return `<button class="item-row" data-action="open-item" data-id="${escapeHtml(item.id)}">
    ${tile(item)}
    <span class="item-text">
      <span class="item-name">${escapeHtml(item.name || "Untitled")}</span>
      <span class="item-sub">${escapeHtml(itemSubtitle(item))}</span>
    </span>
    ${badge}
  </button>`;
}

function visibleItems(state) {
  const query = state.form.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (item.deletedAt) return false;
    if (state.filter === "login" && item.type !== "login") return false;
    if (state.filter === "codes" && !item.totp?.secret) return false;
    if (state.filter === "card" && item.type !== "card") return false;
    if (!query) return true;
    return [
      item.name,
      item.username,
      item.notes,
      item.folder,
      item.totp?.issuer,
      item.totp?.label,
      item.card?.brand,
      item.card?.holder,
      item.identity?.fullName,
      item.identity?.email,
      ...(item.urls ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function vaultListHtml(state) {
  const items = state.items.filter((item) => !item.deletedAt);
  const filtered = visibleItems(state);

  if (items.length === 0) {
    return `<div class="empty">
      <div class="mark-large"></div>
      <h2>A clean slate</h2>
      <p>Your vault is empty. Add a login, secure note or authenticator in the mobile app —
      it will appear here after sync.</p>
    </div>`;
  }
  if (filtered.length === 0) {
    return `<div class="empty">
      <h2>Nothing matches</h2>
      <p>Try another search or switch the filter.</p>
      <button class="btn secondary small" style="width:auto;margin-top:14px"
        data-action="clear-filters">Clear filters</button>
    </div>`;
  }
  return filtered.map(itemRow).join("");
}

function vaultBody(state) {
  const items = state.items.filter((item) => !item.deletedAt);
  const logins = items.filter((item) => item.type === "login").length;
  const codes = items.filter((item) => item.totp?.secret).length;
  const cards = items.filter((item) => item.type === "card").length;
  const list = vaultListHtml(state);

  return `<main class="content">
    <div class="hero">
      <p class="eyebrow">${greeting()}</p>
      <h1 class="display">Your vault.</h1>
      <p class="muted">${items.length} ${items.length === 1 ? "item" : "items"} ·
      ${escapeHtml(syncLabel(state))}</p>
    </div>

    <div class="search">
      <span style="color:var(--faint)">⌕</span>
      <input data-field="query" placeholder="Search your vault" autocomplete="off"
        value="${escapeHtml(state.form.query)}" />
    </div>

    <div class="chips">
      ${chip(state, "all", "All", items.length)}
      ${chip(state, "login", "Logins", logins)}
      ${chip(state, "codes", "2FA", codes)}
      ${chip(state, "card", "Cards", cards)}
    </div>

    <div class="item-list" id="vault-list">${list}</div>

    <p class="tiny center" style="margin-top:16px">
      ${state.fullPage
        ? "Inline suggestions appear on matching login and one-time-code fields. Secrets are decrypted only while this page is unlocked."
        : "Autofill works on the active tab. Secrets are decrypted only while this popup is unlocked."}
    </p>
  </main>`;
}

function detailRow(label, value, options = {}) {
  const {
    mono = false,
    copyField,
    id,
    revealKey,
    revealed = false,
    openUrl,
    placeholder = "Not set",
  } = options;

  const display = value ? (mono ? escapeHtml(value) : escapeHtml(value)) : placeholder;
  const buttons = [];

  if (revealKey) {
    buttons.push(
      `<button class="mini-btn muted" data-action="reveal" data-key="${escapeHtml(revealKey)}">${
        revealed ? "Hide" : "Show"
      }</button>`
    );
  }
  if (openUrl) {
    buttons.push(
      `<button class="mini-btn" data-action="open-url" data-id="${escapeHtml(id)}">Open</button>`
    );
  }
  if (copyField && value) {
    buttons.push(
      `<button class="mini-btn" data-action="copy" data-id="${escapeHtml(id)}"
        data-field="${escapeHtml(copyField)}">Copy</button>`
    );
  }

  return `<div class="detail-row">
    <div class="detail-body">
      <div class="detail-label">${escapeHtml(label)}</div>
      <div class="detail-value ${mono ? "mono" : ""}">${display}</div>
    </div>
    ${buttons.join("")}
  </div>`;
}

function cardNumber(value) {
  const clean = String(value ?? "").replace(/\s+/g, "");
  return clean.replace(/(.{4})/g, "$1 ").trim();
}

function totpCard(item) {
  const totp = item.totp;
  const algorithm = totp.algorithm ?? "SHA1";
  const digits = totp.digits ?? 6;
  const period = totp.period ?? 30;
  return `<div class="code-card">
    <div class="code-head">
      <span class="code-label">Authenticator</span>
      <span class="tiny" id="totp-remaining">—</span>
    </div>
    <div class="code-value" id="totp-code" data-action="copy-totp" title="Copy code">••• •••</div>
    <div class="progress"><span id="totp-progress" style="width:100%"></span></div>
    <div class="code-meta">
      <span>${escapeHtml(algorithm)} · ${digits} digits · ${period}s</span>
      <button class="mini-btn" data-action="copy-totp">Copy code</button>
    </div>
  </div>`;
}

function detailBody(state) {
  const item = state.items.find((entry) => entry.id === state.selectedId);
  if (!item) {
    return `<main class="content"><div class="empty">
      <h2>Item not found</h2><p>It may have been deleted on another device.</p>
      <button class="btn secondary small" style="width:auto;margin-top:14px"
        data-action="back">Back to vault</button>
    </div></main>`;
  }

  const reveal = state.reveal ?? {};
  const passwordKey = `${item.id}:password`;
  const cardKey = `${item.id}:card`;
  const cvvKey = `${item.id}:cvv`;
  const url = item.urls?.[0] ?? "";

  let rows = "";
  if (item.type === "login") {
    rows += `<div class="detail-card">
      ${detailRow("Username", item.username, {
        copyField: "username",
        id: item.id,
      })}
      ${detailRow(
        "Password",
        item.password
          ? reveal[passwordKey]
            ? item.password
            : "••••••••••••"
          : "",
        {
          mono: true,
          copyField: "password",
          id: item.id,
          revealKey: passwordKey,
          revealed: Boolean(reveal[passwordKey]),
        }
      )}
      ${url ? detailRow("Website", url.replace(/^https?:\/\//, ""), { openUrl: true, id: item.id }) : ""}
    </div>`;
  }

  if (item.totp?.secret) {
    rows += totpCard(item);
  }

  if (item.type === "card") {
    rows += `<div class="detail-card">
      ${detailRow(
        "Card number",
        item.card?.number
          ? reveal[cardKey]
            ? cardNumber(item.card.number)
            : lastFour(item.card.number)
          : "",
        {
          mono: true,
          copyField: "cardNumber",
          id: item.id,
          revealKey: cardKey,
          revealed: Boolean(reveal[cardKey]),
        }
      )}
      ${detailRow("Cardholder", item.card?.holder, { copyField: "cardHolder", id: item.id })}
      ${detailRow("Expiry", item.card?.expiry)}
      ${detailRow(
        "Security code",
        item.card?.cvv ? (reveal[cvvKey] ? item.card.cvv : "•••") : "",
        {
          mono: true,
          copyField: "cvv",
          id: item.id,
          revealKey: cvvKey,
          revealed: Boolean(reveal[cvvKey]),
        }
      )}
      ${detailRow("Brand", item.card?.brand)}
    </div>`;
  }

  if (item.type === "identity") {
    rows += `<div class="detail-card">
      ${detailRow("Full name", item.identity?.fullName, { copyField: "fullName", id: item.id })}
      ${detailRow("Email", item.identity?.email, { copyField: "identityEmail", id: item.id })}
      ${detailRow("Phone", item.identity?.phone, { copyField: "phone", id: item.id })}
      ${detailRow("Address", item.identity?.address, { copyField: "address", id: item.id })}
      ${detailRow("Company", item.identity?.company)}
      ${detailRow("Passport / ID", item.identity?.passport, { mono: true })}
    </div>`;
  }

  if (item.notes?.trim()) {
    rows += `<div class="section-label">Notes</div>
      <div class="detail-card"><div class="detail-row">
        <div class="detail-body"><div class="note-body">${escapeHtml(item.notes)}</div></div>
      </div></div>`;
  }

  rows += `<div class="section-label">About</div>
    <div class="detail-card">
      ${detailRow("Folder", item.folder)}
      ${detailRow("Updated", relativeTime(item.updatedAt))}
      ${detailRow("Created", item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "")}
    </div>`;

  const hasPassword = item.type === "login" && Boolean(item.password);
  const canFill = hasPassword && !state.fullPage;
  const canOpen = item.type === "login" && Boolean(url);
  const fillActions =
    canFill || canOpen
      ? `<div class="row-2" style="margin-bottom:12px">
        ${canFill ? `<button class="btn" data-action="fill" data-id="${escapeHtml(item.id)}">Autofill</button>` : ""}
        ${canOpen ? `<button class="btn secondary" data-action="open-url" data-id="${escapeHtml(item.id)}">Open site</button>` : ""}
      </div>
      ${state.fullPage && hasPassword ? `<p class="tiny center" style="margin:0 0 14px">Autofill from the toolbar popup, or choose this login from the inline suggestions on the site.</p>` : ""}`
      : "";

  return `<main class="content">
    ${errorCallout(state)}
    <div class="detail-head">
      ${tile(item)}
      <div style="min-width:0">
        <h1>${escapeHtml(item.name || "Untitled")}</h1>
        <p>${escapeHtml(typeLabel(item))}${item.folder ? ` · ${escapeHtml(item.folder)}` : ""}</p>
      </div>
    </div>

    ${fillActions}
    ${rows}

    <p class="tiny center" style="margin-top:14px">
      Edit this item in the mobile app. Changes sync here on the next refresh.
    </p>
  </main>`;
}

function settingsBody(state) {
  const config = state.config ?? {};
  return `<main class="content">
    <div class="hero">
      <p class="eyebrow">Preferences</p>
      <h1 class="display">Settings</h1>
      <p class="muted">This extension is a window into your synced vault. Logins can be saved here; other item types are edited on mobile.</p>
    </div>

    ${errorCallout(state)}

    <div class="settings-card">
      <div class="settings-row">
        <span class="tile" style="background:var(--accent-soft);color:var(--accent)">${escapeHtml(
          (hostOf(config.serverUrl)[0] || "F").toUpperCase()
        )}</span>
        <div class="settings-text">
          <div class="settings-title">${escapeHtml(hostOf(config.serverUrl))}</div>
          <div class="settings-sub">${escapeHtml(config.email ?? "")}</div>
        </div>
        <span class="badge">CONNECTED</span>
      </div>
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">${escapeHtml(config.serverUrl ?? "")}</div>
          <div class="settings-sub">Revision ${state.cache?.revision ?? 0} · ${escapeHtml(
            syncLabel(state)
          )}</div>
        </div>
        <button class="mini-btn" data-action="sync">${state.syncing ? "Syncing…" : "Sync"}</button>
      </div>
    </div>

    <div class="row-2" style="margin-bottom:12px">
      <button class="btn soft small" data-action="sync" ${state.syncing ? "disabled" : ""}>Sync now</button>
      <button class="btn secondary small" data-action="lock">Lock vault</button>
    </div>

    <div class="section-label">Security</div>
    <div class="settings-card">
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Auto-lock</div>
          <div class="settings-sub">Clears the derived key after 15 idle minutes</div>
        </div>
        <span class="badge">15 MIN</span>
      </div>
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Vault encryption</div>
          <div class="settings-sub">AES-256-GCM · per-item envelopes</div>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Key derivation</div>
          <div class="settings-sub">PBKDF2-SHA256 · 210,000 rounds</div>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Server knowledge</div>
          <div class="settings-sub">Ciphertext, auth verifier and KDF params only</div>
        </div>
      </div>
    </div>

    <div class="section-label">Autofill</div>
    <div class="settings-card">
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Inline suggestions</div>
          <div class="settings-sub">Appear when a login or one-time-code field gets focus</div>
        </div>
        <span class="badge">ON</span>
      </div>
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Host matching</div>
          <div class="settings-sub">Only the saved hostname or its subdomains — never look-alikes</div>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">One-time codes</div>
          <div class="settings-sub">Generated locally and filled only when you choose an item</div>
        </div>
      </div>
    </div>

    <div class="callout info" style="margin-top:12px">
      <div><strong>Autofill and save in the browser.</strong>Create cards, notes,
      identities and TOTP items in the mobile app. FlexiVault offers to save or
      update a login after a trusted form submit.</div>
    </div>

    <div class="section-label">Connection</div>
    <div class="settings-card">
      <div class="settings-row">
        <div class="settings-text">
          <div class="settings-title">Disconnect this browser</div>
          <div class="settings-sub">Removes the cached encrypted vault and session token</div>
        </div>
        <button class="mini-btn ${state.disconnectArmed ? "danger" : "muted"}"
          data-action="disconnect">${state.disconnectArmed ? "Tap again" : "Disconnect"}</button>
      </div>
    </div>

    <p class="tiny center" style="margin-top:18px">
      FlexiVault extension · v${globalThis.chrome?.runtime?.getManifest?.().version ?? "1.1.0"} · keys stay with you
    </p>
  </main>`;
}

export function appHtml(state) {
  let body = "";
  switch (state.view) {
    case "setup":
      body = setupBody(state);
      break;
    case "locked":
      body = lockedBody(state);
      break;
    case "detail":
      body = detailBody(state);
      break;
    case "settings":
      body = settingsBody(state);
      break;
    case "vault":
      body = vaultBody(state);
      break;
    default:
      body = `<main class="content"><div class="empty"><div class="mark-large"></div>
        <h2>FlexiVault</h2><p>Preparing your vault…</p></div></main>`;
  }

  return `<div class="screen">${topbar(state)}${body}${footer(state)}</div>`;
}
