/* Autofill bridge + inline, host-matched suggestions. */

const SUGGEST_HOST_ID = "flexivault-suggest-host";
const SUGGEST_DELAY_MS = 80;
const SUGGEST_MARGIN = 8;

const PALETTES = [
  ["#DDF6EC", "#0B8563"],
  ["#E5E9FC", "#3E4DB3"],
  ["#FCEBDD", "#A85A19"],
  ["#FBE2EA", "#B0325B"],
  ["#E1EFFC", "#2668A7"],
  ["#F1E6FD", "#6F3FB5"],
  ["#FBF4D4", "#8A6C0C"],
  ["#E3F4F8", "#1F7486"],
];

function paletteFor(seed) {
  let hash = 0;
  const value = String(seed ?? "");
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 9973;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

function initialOf(name) {
  const clean = String(name ?? "").trim();
  return (clean[0] || "•").toUpperCase();
}

function visible(element) {
  if (!element || element.disabled || element.readOnly) return false;
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return false;
  return true;
}

function setValue(element, value) {
  if (!element || value === undefined || value === null || value === "") return false;

  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  element.focus();
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.blur();
  return true;
}

function fieldHaystack(element) {
  return [
    element.name,
    element.id,
    element.getAttribute("aria-label"),
    element.placeholder,
    element.getAttribute("autocomplete"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function looksLikeUsername(element) {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.type === "email") return true;
  if (element.autocomplete === "username") return true;
  return /user|email|login|account|identifier/.test(fieldHaystack(element));
}

function isSearchField(element) {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.type === "search" || element.getAttribute("role") === "searchbox") {
    return true;
  }
  return /\bsearch\b/.test(fieldHaystack(element)) && !/user|login|email/.test(fieldHaystack(element));
}

function isOtpField(element) {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.autocomplete === "one-time-code") return true;
  if (element.autocomplete === "cc-csc") return false;

  const haystack = fieldHaystack(element);
  if (
    /cvv|cvc|card.?security|security.?code|card.?verification/.test(haystack) &&
    !/otp|totp|2fa|mfa|one.?time|authenticator/.test(haystack)
  ) {
    return false;
  }

  const strong = /(^|[^a-z])(otp|totp|2fa|mfa|one.?time|authenticator|verification.?code|auth.?code)([^a-z]|$)/;
  if (!strong.test(haystack)) {
    return (
      element.inputMode === "numeric" &&
      element.maxLength === 6 &&
      /\bcode\b/.test(haystack)
    );
  }
  return true;
}

function existingPasswordFields(scope) {
  return Array.from(scope.querySelectorAll('input[type="password"]'))
    .filter(visible)
    .filter((element) => element.autocomplete !== "new-password");
}

function findPasswordField(field) {
  const form = field.closest("form");
  const scope = form ?? document;
  const fields = existingPasswordFields(scope);
  if (fields.length === 0) return null;

  const top = field.getBoundingClientRect().top;
  const after = fields.filter(
    (element) => element.getBoundingClientRect().top >= top
  );
  return after[0] ?? fields[0];
}

function isLoginField(element) {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.type !== "email" && !looksLikeUsername(element)) return false;
  if (isSearchField(element)) return false;
  return Boolean(findPasswordField(element));
}

function fieldKind(element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    return null;
  }
  if (element.disabled || element.readOnly || !visible(element)) return null;

  if (element instanceof HTMLInputElement) {
    if (
      [
        "hidden",
        "submit",
        "button",
        "checkbox",
        "radio",
        "file",
        "image",
        "range",
        "color",
        "date",
        "datetime-local",
        "month",
        "week",
        "time",
        "search",
      ].includes(element.type)
    ) {
      return null;
    }
    if (element.autocomplete === "new-password") return null;
  }

  if (isOtpField(element)) return "otp";
  if (element instanceof HTMLInputElement && element.type === "password") {
    return "login";
  }
  if (isLoginField(element)) return "login";
  return null;
}

function findUsernameField(passwordField) {
  const form = passwordField.closest("form");
  const scope = form ?? document;
  const fields = Array.from(scope.querySelectorAll("input")).filter(
    (element) =>
      visible(element) &&
      !["password", "hidden", "submit", "button", "checkbox", "radio"].includes(
        element.type
      ) &&
      !isOtpField(element) &&
      !isSearchField(element)
  );

  const strong = fields.find(looksLikeUsername);
  if (strong) return strong;

  const passwordIndex = fields.indexOf(passwordField);
  const before = passwordIndex === -1 ? fields : fields.slice(0, passwordIndex);
  const textField = before
    .reverse()
    .find((element) => ["text", "email", "tel", ""].includes(element.type));
  return textField ?? null;
}

function fill(username, password) {
  const passwordField = existingPasswordFields(document)[0];

  if (!passwordField) {
    return {
      ok: false,
      filled: 0,
      message: "No existing-password field found on this page.",
    };
  }

  let filled = 0;
  const usernameField = findUsernameField(passwordField);

  if (usernameField && username) {
    if (setValue(usernameField, username)) filled += 1;
  }
  if (setValue(passwordField, password)) filled += 1;

  return { ok: filled > 0, filled };
}

function fillForField(field, username, password) {
  let usernameField = null;
  let passwordField = null;

  if (field instanceof HTMLInputElement && field.type === "password") {
    passwordField = field;
    usernameField = findUsernameField(field);
  } else {
    usernameField = field;
    passwordField = findPasswordField(field);
  }

  let filled = 0;
  if (usernameField && username && setValue(usernameField, username)) filled += 1;
  if (passwordField && password && setValue(passwordField, password)) filled += 1;
  return filled;
}

/* --------------------------- suggestion surface --------------------------- */

const SUGGEST_CSS = `
  :host { all: initial; }
  .panel {
    position: fixed;
    box-sizing: border-box;
    width: 320px;
    max-width: calc(100vw - 16px);
    padding: 5px;
    background: #0f1714;
    border: 1px solid #2c3d36;
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
    color: #ecf5f0;
    font: 13px/1.4 "Space Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif;
    pointer-events: auto;
    z-index: 2147483647;
  }
  .panel[hidden] { display: none; }
  .head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px 5px;
    color: #93a69e;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .mark {
    width: 13px;
    height: 13px;
    border-radius: 4px;
    background: #3fe0b0;
    box-shadow: inset 0 0 0 3px #03231a;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 7px 8px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row:hover, .row.active { background: #15201c; }
  .tile {
    width: 30px;
    height: 30px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .text { flex: 1; min-width: 0; }
  .name {
    display: block;
    font-size: 12.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    display: block;
    margin-top: 1px;
    font-size: 10.5px;
    color: #93a69e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    flex-shrink: 0;
    padding: 3px 6px;
    border-radius: 999px;
    background: #10342a;
    color: #3fe0b0;
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
  }
  .foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 3px;
    padding: 6px 8px 3px;
    border-top: 1px solid #1e2b26;
    color: #5e7169;
    font-size: 9.5px;
  }
`;

let panelHost = null;
let panel = null;
let activeField = null;
let activeKind = null;
let activeItems = [];
let activeIndex = -1;
let panelHovered = false;
let focusTimer = null;
let requestToken = 0;
let filling = false;

function ensurePanel() {
  if (panelHost?.isConnected && panel) return panel;

  panelHost = document.createElement("div");
  panelHost.id = SUGGEST_HOST_ID;
  panelHost.style.cssText =
    "all: initial; position: fixed; left: 0; top: 0; width: 0; height: 0; " +
    "z-index: 2147483647; pointer-events: none;";

  const root = panelHost.attachShadow({ mode: "closed" });
  let styled = false;
  try {
    if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(SUGGEST_CSS);
      root.adoptedStyleSheets = [sheet];
      styled = true;
    }
  } catch {
    styled = false;
  }
  if (!styled) {
    const style = document.createElement("style");
    style.textContent = SUGGEST_CSS;
    root.append(style);
  }

  panel = document.createElement("div");
  panel.className = "panel";
  panel.hidden = true;
  panel.setAttribute("role", "listbox");
  panel.setAttribute("aria-label", "FlexiVault suggestions");
  panel.addEventListener("mousedown", (event) => event.preventDefault());
  panel.addEventListener("mouseenter", () => {
    panelHovered = true;
  });
  panel.addEventListener("mouseleave", () => {
    panelHovered = false;
  });

  root.append(panel);
  document.documentElement.appendChild(panelHost);
  return panel;
}

function updateActive() {
  if (!panel) return;
  const rows = panel.querySelectorAll(".row");
  for (let index = 0; index < rows.length; index += 1) {
    const selected = index === activeIndex;
    rows[index].setAttribute("aria-selected", selected ? "true" : "false");
    rows[index].classList.toggle("active", selected);
    if (selected && typeof rows[index].scrollIntoView === "function") {
      rows[index].scrollIntoView({ block: "nearest" });
    }
  }
}

function renderPanel(kind, items) {
  const surface = ensurePanel();
  surface.replaceChildren();

  const head = document.createElement("div");
  head.className = "head";
  const mark = document.createElement("span");
  mark.className = "mark";
  const title = document.createElement("span");
  title.textContent = kind === "otp" ? "Authenticator code" : "Saved logins";
  head.append(mark, title);

  const list = document.createElement("div");
  list.setAttribute("role", "presentation");

  items.forEach((item, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "row";
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.title = item.name || "Untitled";

    const [background, color] = paletteFor(item.name || item.id);
    const tile = document.createElement("span");
    tile.className = "tile";
    tile.style.background = background;
    tile.style.color = color;
    tile.textContent = initialOf(item.name);

    const text = document.createElement("span");
    text.className = "text";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = item.name || "Untitled";
    const sub = document.createElement("span");
    sub.className = "sub";
    sub.textContent =
      kind === "otp"
        ? [item.issuer, item.label || item.username].filter(Boolean).join(" · ") ||
          "One-time code"
        : item.username || "Saved login";
    text.append(name, sub);
    row.append(tile, text);

    if (kind === "otp") {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = "CODE";
      row.append(badge);
    }

    row.addEventListener("mouseenter", () => {
      activeIndex = index;
      updateActive();
    });
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void choose(item);
    });

    list.append(row);
  });

  const foot = document.createElement("div");
  foot.className = "foot";
  const left = document.createElement("span");
  left.textContent = "FlexiVault";
  const right = document.createElement("span");
  right.textContent = "↑↓ · ↵";
  foot.append(left, right);

  surface.append(head, list, foot);
  activeItems = items;
  activeIndex = -1;
  return surface;
}

function positionPanel(field) {
  if (!panel || panel.hidden) return;
  const rect = field.getBoundingClientRect();
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    closePanel();
    return;
  }

  const bounds = panel.getBoundingClientRect();
  const width = Math.min(
    Math.max(rect.width, 300),
    Math.max(0, window.innerWidth - SUGGEST_MARGIN * 2)
  );
  let left = rect.left;
  if (left + width > window.innerWidth - SUGGEST_MARGIN) {
    left = window.innerWidth - width - SUGGEST_MARGIN;
  }
  left = Math.max(SUGGEST_MARGIN, left);

  let top = rect.bottom + 6;
  if (top + bounds.height > window.innerHeight - SUGGEST_MARGIN) {
    top = Math.max(SUGGEST_MARGIN, rect.top - bounds.height - 6);
  }

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.width = `${Math.round(width)}px`;
}

function showPanel(field, kind, items) {
  const surface = renderPanel(kind, items);
  surface.hidden = false;
  surface.style.visibility = "hidden";
  positionPanel(field);
  if (panel !== surface || !panelHost?.isConnected) return;
  surface.style.visibility = "visible";
}

function closePanel() {
  requestToken += 1;
  activeField = null;
  activeKind = null;
  activeItems = [];
  activeIndex = -1;
  panelHovered = false;
  if (panelHost?.isConnected) panelHost.remove();
  panelHost = null;
  panel = null;
}

function scheduleRequest(field, kind) {
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    void requestSuggestions(field, kind);
  }, SUGGEST_DELAY_MS);
}

async function requestSuggestions(field, kind) {
  if (filling) return;
  if (!field?.isConnected || document.activeElement !== field) return;
  if (fieldKind(field) !== kind) return;
  if (activeField === field && panel && !panel.hidden) return;
  if (typeof chrome === "undefined" || typeof chrome.runtime?.sendMessage !== "function") {
    return;
  }

  activeField = field;
  activeKind = kind;
  activeItems = [];
  activeIndex = -1;
  if (panel) panel.hidden = true;

  const token = ++requestToken;
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "flexivault:suggest",
      kind,
    });
  } catch {
    return;
  }

  if (token !== requestToken || activeField !== field || !field.isConnected) {
    return;
  }
  if (!response?.ok || response.locked || !response.items?.length) {
    if (token === requestToken) closePanel();
    return;
  }

  showPanel(field, kind, response.items.slice(0, 6));
}

async function choose(item) {
  const field = activeField;
  const kind = activeKind;
  if (!field || !field.isConnected || !item) return;

  filling = true;
  closePanel();
  try {
    let response;
    try {
      response = await chrome.runtime.sendMessage({
        type: "flexivault:suggest-fill",
        id: item.id,
        kind,
      });
    } catch {
      return;
    }

    if (!response?.ok) return;
    if (kind === "otp") {
      setValue(field, String(response.code ?? ""));
    } else {
      fillForField(
        field,
        String(response.username ?? ""),
        String(response.password ?? "")
      );
    }
  } finally {
    filling = false;
    clearTimeout(focusTimer);
  }
}

function eligibleField(target) {
  if (!(target instanceof Element)) return null;
  const field = target.closest("input, textarea");
  if (!field) return null;
  const kind = fieldKind(field);
  return kind ? { field, kind } : null;
}

document.addEventListener(
  "focusin",
  (event) => {
    const found = eligibleField(event.target);
    if (!found) return;
    scheduleRequest(found.field, found.kind);
  },
  true
);

document.addEventListener(
  "click",
  (event) => {
    const found = eligibleField(event.target);
    if (!found) return;
    if (found.field === activeField && panel && !panel.hidden) return;
    scheduleRequest(found.field, found.kind);
  },
  true
);

document.addEventListener(
  "pointerdown",
  (event) => {
    if (!panel || panel.hidden) return;
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.includes(panel) || path.includes(panelHost)) return;
    if (event.target === activeField) return;
    closePanel();
  },
  true
);

document.addEventListener(
  "focusout",
  (event) => {
    if (event.target !== activeField) return;
    const field = event.target;
    setTimeout(() => {
      if (activeField !== field || panelHovered) return;
      if (document.activeElement !== field) closePanel();
    }, 140);
  },
  true
);

document.addEventListener(
  "keydown",
  (event) => {
    if (!event.isTrusted) return;
    if (!panel || panel.hidden || !activeField) return;
    if (document.activeElement !== activeField) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      activeIndex = activeItems.length
        ? (activeIndex + 1) % activeItems.length
        : -1;
      updateActive();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      activeIndex = activeItems.length
        ? (activeIndex - 1 + activeItems.length) % activeItems.length
        : -1;
      updateActive();
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      const item = activeItems[activeIndex];
      if (item) void choose(item);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    }
  },
  true
);

window.addEventListener(
  "scroll",
  () => {
    if (panel && !panel.hidden && activeField) positionPanel(activeField);
  },
  true
);

window.addEventListener("resize", () => {
  if (panel && !panel.hidden && activeField) positionPanel(activeField);
});

window.addEventListener("blur", () => {
  if (panel && !panel.hidden) closePanel();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "flexivault:fill") return undefined;

  try {
    const result = fill(
      String(message.username ?? ""),
      String(message.password ?? "")
    );
    sendResponse(result);
  } catch (error) {
    sendResponse({ ok: false, filled: 0, message: error.message });
  }

  return true;
});
