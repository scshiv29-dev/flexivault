/**
 * Identifier-first ("multi-step") sign-in test in jsdom.
 *
 * AWS, Google and Microsoft ask for the email first, sometimes show a captcha,
 * and only then ask for the password — either later in the same page (a
 * single-page-app transition) or on a new page. The content script must offer
 * the username on the first step, remember it, and offer the matching
 * password on the later step.
 *
 * Run: node scripts/multi-step-test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

import { filterByTyped, preferUsername } from "../src/presentation.js";

const source = await readFile(
  fileURLToPath(new URL("../content.js", import.meta.url)),
  "utf8"
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Two saved accounts for the same site. The second is the one the user picks
// on the email step, so a correct password step must put it first even though
// the worker would otherwise list the first one first.
const accounts = [
  { id: "acct_ops", name: "AWS", username: "ops@example.com", password: "ops-password" },
  { id: "acct_root", name: "AWS", username: "root@example.com", password: "root-password" },
];

// A stand-in for the background worker shared across pages of one tab: it
// keeps the remembered username like the real worker (see background-test).
const worker = {
  remembered: "",
  suggestQueries: [],
  fills: [],
  remembers: [],
};

async function workerMessage(message) {
  if (message.type === "flexivault:remember-username") {
    worker.remembers.push(message.username);
    worker.remembered = message.username;
    return { ok: true };
  }
  if (message.type === "flexivault:suggest") {
    worker.suggestQueries.push(message.query ?? "");
    if (message.kind !== "login") {
      return { ok: true, configured: true, locked: false, items: [] };
    }
    let items = filterByTyped(accounts, message.query);
    if (!String(message.query ?? "").trim()) items = preferUsername(items, worker.remembered);
    return {
      ok: true,
      configured: true,
      locked: false,
      items: items.map(({ id, name, username }) => ({ id, name, username })),
    };
  }
  if (message.type === "flexivault:suggest-fill") {
    worker.fills.push(message.id);
    const account = accounts.find((entry) => entry.id === message.id);
    return { ok: true, username: account.username, password: account.password };
  }
  return { ok: false };
}

/** Loads a page and runs content.js in it, like a fresh navigation. */
function openPage(url, html, { beforeScript } = {}) {
  const dom = new JSDOM(`<!doctype html><html><head><title>Sign in</title></head><body>${html}</body></html>`, {
    url,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  let suggestionRoot = null;
  const attachShadow = window.Element.prototype.attachShadow;
  window.Element.prototype.attachShadow = function attachShadowSpy(init) {
    const root = attachShadow.call(this, init);
    if (init?.mode === "closed") suggestionRoot = root;
    return root;
  };

  // jsdom has no layout. Fields inside a `hidden` container have no size,
  // like a password step that a sign-in app has not revealed yet.
  window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    const shown = !this.closest("[hidden]");
    const size = shown ? { width: 120, height: 32 } : { width: 0, height: 0 };
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: size.width,
      bottom: size.height,
      ...size,
      toJSON() {
        return this;
      },
    };
  };

  window.chrome = {
    runtime: {
      id: "flexivault-test",
      onMessage: { addListener() {} },
      sendMessage: workerMessage,
    },
  };

  beforeScript?.(window);
  window.eval(source);

  const doc = window.document;
  return {
    window,
    doc,
    $: (id) => doc.getElementById(id),
    rows() {
      const panel = suggestionRoot?.querySelector(".panel");
      if (!panel || panel.hidden || !doc.getElementById("flexivault-suggest-host")) return [];
      return Array.from(suggestionRoot.querySelectorAll(".row .sub")).map((node) => node.textContent);
    },
    async focus(field) {
      field.focus();
      field.dispatchEvent(new window.Event("focusin", { bubbles: true }));
      await wait(220);
    },
    async chooseRow(index = 0) {
      const row = suggestionRoot.querySelectorAll(".row")[index];
      assert.ok(row, `suggestion row ${index} exists`);
      row.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
      await wait(120);
    },
    close() {
      // Retire this instance first (as a re-injection would), so its observers
      // stop before jsdom tears the document down.
      window.__flexivaultContentInstance = {};
      window.close();
    },
  };
}

/* ---------- 1. Same page: the password step is revealed by a DOM change ---------- */
{
  const page = openPage(
    "https://accounts.example.test/v3/signin/identifier",
    `<form id="flow" action="#">
       <div id="email-step">
         <input id="identifier" type="email" name="identifier" autocomplete="username" />
         <button id="next" type="button">Next</button>
       </div>
       <div id="password-step" hidden>
         <input id="passwd" type="password" name="Passwd" autocomplete="current-password" />
       </div>
     </form>`
  );
  const identifier = page.$("identifier");
  const passwd = page.$("passwd");

  // The email step alone offers saved usernames.
  await page.focus(identifier);
  assert.deepEqual(page.rows(), ["ops@example.com", "root@example.com"],
    "the username-only step offers the saved accounts");

  await page.chooseRow(1);
  assert.equal(identifier.value, "root@example.com", "the email step fills the username");
  assert.equal(passwd.value, "", "the hidden password field is not filled on the email step");
  assert.equal(worker.remembered, "root@example.com", "the chosen username is remembered for the next step");

  // The app hides the email step and reveals the password step. It focuses
  // the password input while it is still hidden, so the focus event itself
  // cannot offer anything; the reveal must.
  page.$("email-step").hidden = true;
  passwd.focus();
  passwd.dispatchEvent(new page.window.Event("focusin", { bubbles: true }));
  await wait(150);
  assert.deepEqual(page.rows(), [], "a hidden password field offers nothing");
  page.$("password-step").hidden = false;
  await wait(400);

  assert.equal(worker.suggestQueries.at(-1), "", "the password step has no typed username");
  assert.deepEqual(page.rows(), ["root@example.com", "ops@example.com"],
    "the revealed password field offers the account from the email step first");

  await page.chooseRow(0);
  assert.equal(worker.fills.at(-1), "acct_root");
  assert.equal(passwd.value, "root-password", "the matching password is filled");
  assert.equal(identifier.value, "root@example.com", "the hidden email field keeps its value");

  // Dismissing the list must not make unrelated DOM changes reopen it.
  passwd.value = "";
  const before = worker.suggestQueries.length;
  page.doc.body.append(page.doc.createElement("div"));
  page.$("password-step").className = "animating";
  await wait(300);
  assert.equal(worker.suggestQueries.length, before, "an offered field is not re-offered on every mutation");
  page.close();
}

/* ---------- 2. Same page: the password input is inserted later ---------- */
{
  worker.remembered = "";
  const page = openPage(
    "https://example.test/login",
    `<div id="app"><input id="user" name="username" autocomplete="username" /></div>`
  );
  const user = page.$("user");
  user.value = "ops@example.com";
  // Typing and leaving the field (blur fires `change`) remembers the username.
  user.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  await wait(20);
  assert.equal(worker.remembered, "ops@example.com", "a typed username is remembered on change");

  // The app swaps the email view for a password view without a <form>.
  page.$("app").innerHTML = `<input id="pw" type="password" name="password" autofocus />`;
  page.$("pw").focus();
  await wait(400);
  assert.deepEqual(page.rows(), ["ops@example.com", "root@example.com"],
    "an inserted, focused password field is offered with the remembered account first");
  await page.chooseRow(0);
  assert.equal(page.$("pw").value, "ops-password");
  page.close();
}

/* ---------- 3. Separate pages with a captcha step in between ---------- */
{
  worker.remembered = "";
  // Page 1: the email step (AWS root sign-in style, no password field).
  const step1 = openPage(
    "https://signin.example.test/signin?redirect_uri=console",
    `<form id="resolve">
       <input id="resolving_input" type="email" name="email" />
       <button type="submit">Next</button>
     </form>`
  );
  const email = step1.$("resolving_input");
  await step1.focus(email);
  assert.equal(step1.rows().length, 2, "the email page offers the saved usernames");
  await step1.chooseRow(1);
  assert.equal(email.value, "root@example.com");
  assert.equal(worker.remembered, "root@example.com");
  step1.close();

  // Page 2: a captcha. FlexiVault must not offer, fill or remember anything.
  const step2 = openPage(
    "https://signin.example.test/signin/captcha",
    `<form id="captcha-form">
       <img alt="captcha" />
       <label for="captchaGuess">Type the characters you see</label>
       <input id="captchaGuess" name="captchaGuess" type="text" />
     </form>`
  );
  const guess = step2.$("captchaGuess");
  const queriesBefore = worker.suggestQueries.length;
  await step2.focus(guess);
  assert.equal(worker.suggestQueries.length, queriesBefore, "a captcha field asks for nothing");
  assert.deepEqual(step2.rows(), [], "a captcha field shows no suggestions");
  guess.value = "x7k2p";
  guess.dispatchEvent(new step2.window.Event("change", { bubbles: true }));
  await wait(20);
  assert.equal(worker.remembered, "root@example.com", "the captcha answer is not remembered as a username");
  step2.close();

  // Page 3: the password page autofocuses its password field before the
  // content script runs, and a second captcha field sits below it.
  const step3 = openPage(
    "https://signin.example.test/signin/password",
    `<form id="password-form">
       <input id="password" type="password" name="password" />
       <input id="captcha2" name="captcha_answer" type="text" aria-label="Captcha" />
     </form>`,
    {
      beforeScript(window) {
        window.document.getElementById("password").focus();
      },
    }
  );
  await wait(300);
  assert.equal(worker.suggestQueries.at(-1), "", "the captcha text is not used as a typed username");
  assert.deepEqual(step3.rows(), ["root@example.com", "ops@example.com"],
    "the autofocused password field on a new page offers the remembered account first");
  await step3.chooseRow(0);
  assert.equal(worker.fills.at(-1), "acct_root");
  assert.equal(step3.$("password").value, "root-password", "the password from the email step's account is filled");
  assert.equal(step3.$("captcha2").value, "", "the captcha field is never filled");
  step3.close();
}

/* ---------- 4. A single form with both fields still works ---------- */
{
  worker.remembered = "";
  const page = openPage(
    "https://example.test/login",
    `<form id="login">
       <input id="email" type="email" name="email" />
       <input id="password" type="password" name="password" />
     </form>`
  );
  await page.focus(page.$("email"));
  assert.equal(page.rows().length, 2);
  await page.chooseRow(0);
  assert.equal(page.$("email").value, "ops@example.com");
  assert.equal(page.$("password").value, "ops-password", "a single form fills both fields at once");
  page.close();
}

console.log("Multi-step sign-in checks passed.");
