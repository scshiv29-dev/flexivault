/**
 * Autofill content-script test in jsdom.
 * Run: node scripts/content-test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
  `<!doctype html>
   <html>
     <body>
       <form id="login">
         <input id="email" type="email" name="email" />
         <input id="password" type="password" name="password" />
       </form>
       <form id="signup">
         <input id="new-password" type="password" autocomplete="new-password" />
       </form>
       <form id="card">
         <input id="cvv" name="cvv" autocomplete="cc-csc" inputmode="numeric" maxlength="6" aria-label="Card security code" />
         <input id="cvc" name="card_verification_code" inputmode="numeric" maxlength="6" aria-label="Card verification code" />
       </form>
       <form id="otp">
         <input id="code" name="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6" />
       </form>
     <form id="email-only">
       <input id="email-only-input" type="email" name="email" autocomplete="username" />
     </form>
     <div id="shadow-host"></div>
     </body>
   </html>`,
  {
    url: "https://acme.test/login",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  }
);

const { window } = dom;

// A web-component login rendered inside an open shadow root, like Reddit's
// faceplate inputs. The content script must discover and fill these fields even
// though `document.querySelector` cannot see them.
const shadowHost = window.document.getElementById("shadow-host");
const shadowRoot = shadowHost.attachShadow({ mode: "open" });
shadowRoot.innerHTML = `
  <form id="shadow-form">
    <input id="shadow-email" type="email" name="email" autocomplete="username" />
    <input id="shadow-password" type="password" name="password" />
  </form>
`;

// The UI lives in a closed shadow root. Capture it the way a test harness
// would, while asserting below that the page cannot reach it.
let suggestionRoot = null;
const attachShadow = window.Element.prototype.attachShadow;
window.Element.prototype.attachShadow = function attachShadowSpy(init) {
  const root = attachShadow.call(this, init);
  if (init?.mode === "closed") suggestionRoot = root;
  return root;
};

// jsdom has no layout; make every field look visible to the script.
window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 120,
    bottom: 32,
    width: 120,
    height: 32,
    toJSON() {
      return this;
    },
  };
};

let listener = null;
const listeners = [];
const fillRequests = [];
const suggestionItems = {
  login: [{ id: "login_1", name: "Acme Portal", username: "ada@example.com" }],
  otp: [
    {
      id: "login_1",
      name: "Acme Portal",
      issuer: "Acme",
      label: "ada@example.com",
    },
  ],
};
let vaultLocked = false;
let unlockOpenRequests = 0;

window.chrome = {
  runtime: {
    onMessage: {
      addListener(handler) {
        listeners.push(handler);
        listener = handler;
      },
    },
    async sendMessage(message) {
      if (message.type === "flexivault:suggest") {
        return {
          ok: true,
          configured: true,
          locked: vaultLocked,
          items: vaultLocked ? [] : suggestionItems[message.kind] ?? [],
        };
      }
      if (message.type === "flexivault:suggest-fill") {
        fillRequests.push(message);
        if (message.kind === "otp") return { ok: true, code: "123456" };
        return {
          ok: true,
          username: "ada@example.com",
          password: "s3cret-value",
        };
      }
      if (message.type === "flexivault:unlock-open") {
        unlockOpenRequests += 1;
        return { ok: true, token: "test-unlock" };
      }
      return { ok: false };
    },
  },
};

const source = await readFile(
  fileURLToPath(new URL("../content.js", import.meta.url)),
  "utf8"
);
window.eval(source);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function focusField(field) {
  field.focus();
  field.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  await wait(220);
}

function suggestionHost() {
  return window.document.getElementById("flexivault-suggest-host");
}

async function chooseFirstSuggestion() {
  const host = suggestionHost();
  assert.ok(host, "suggestion surface is attached to the page");
  assert.equal(host.shadowRoot, null, "the page cannot inspect the closed root");
  assert.ok(suggestionRoot, "the closed suggestion root exists");
  const panel = suggestionRoot.querySelector(".panel");
  assert.ok(panel && !panel.hidden, "suggestion panel is visible");
  const row = suggestionRoot.querySelector(".row");
  assert.ok(row, "suggestion panel has a row");
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true, composed: true }));
  await wait(120);
}

assert.equal(typeof listener, "function", "content script registers a listener");
assert.equal(
  listener({ type: "flexivault:unrelated" }, {}, () => {}),
  undefined,
  "other messages are ignored"
);

function send(message) {
  let response;
  const keepOpen = listener(message, {}, (value) => {
    response = value;
  });
  return { response, keepOpen };
}

const events = [];
window.document.getElementById("email").addEventListener("input", (event) => {
  events.push(event.target.value);
});

const filled = send({
  type: "flexivault:fill",
  username: "ada@example.com",
  password: "s3cret-value",
});

assert.equal(filled.keepOpen, true);
assert.equal(filled.response.ok, true);
assert.equal(filled.response.filled, 2);
assert.equal(window.document.getElementById("email").value, "ada@example.com");
assert.equal(window.document.getElementById("password").value, "s3cret-value");
assert.deepEqual(events, ["ada@example.com"], "React input event is dispatched");

// Focusing a username field asks the worker for host-matched logins.
window.document.getElementById("email").value = "";
window.document.getElementById("password").value = "";
await focusField(window.document.getElementById("email"));

// A page cannot synthesize keystrokes to select a credential.
window.document.getElementById("email").dispatchEvent(
  new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
);
window.document.getElementById("email").dispatchEvent(
  new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })
);
await wait(50);
assert.equal(fillRequests.length, 0, "synthetic keystrokes cannot select a suggestion");
assert.equal(window.document.getElementById("email").value, "");

await chooseFirstSuggestion();

assert.equal(fillRequests.length, 1);
assert.equal(fillRequests[0].kind, "login");
assert.equal(fillRequests[0].id, "login_1");
assert.equal(window.document.getElementById("email").value, "ada@example.com");
assert.equal(window.document.getElementById("password").value, "s3cret-value");
assert.equal(suggestionHost(), null, "the suggestion host is removed after selection");

// A one-time-code field gets a live code instead of a password.
await focusField(window.document.getElementById("code"));
await chooseFirstSuggestion();

assert.equal(fillRequests.length, 2);
assert.equal(fillRequests[1].kind, "otp");
assert.equal(window.document.getElementById("code").value, "123456");

// A signup confirmation field must never request suggestions.
await focusField(window.document.getElementById("new-password"));
assert.equal(fillRequests.length, 2, "new-password fields are ignored");
assert.equal(
  suggestionHost(),
  null,
  "no suggestion host remains for a new-password field"
);

// Card security codes are not one-time codes.
await focusField(window.document.getElementById("cvv"));
await focusField(window.document.getElementById("cvc"));
assert.equal(fillRequests.length, 2, "card security fields are ignored");
assert.equal(suggestionHost(), null, "card security fields show no suggestions");

// Login inputs inside an open shadow root are discovered through composed
// focus events and filled without touching the page's light DOM.
const shadowEmail = shadowRoot.getElementById("shadow-email");
await focusField(shadowEmail);
await chooseFirstSuggestion();

assert.equal(fillRequests.length, 3);
assert.equal(fillRequests[2].kind, "login");
assert.equal(shadowEmail.value, "ada@example.com");
assert.equal(shadowRoot.getElementById("shadow-password").value, "s3cret-value");

// Google's first sign-in step has only an email field. It must still offer the
// saved username instead of waiting for a password input.
const emailOnly = window.document.getElementById("email-only-input");
await focusField(emailOnly);
await chooseFirstSuggestion();

assert.equal(fillRequests.length, 4);
assert.equal(emailOnly.value, "ada@example.com");
assert.equal(
  window.document.querySelectorAll('#email-only input[type="password"]').length,
  0,
  "the email-only step fills only the username"
);

vaultLocked = true;
await focusField(window.document.getElementById("email"));
assert.ok(suggestionRoot.textContent.includes("Unlock FlexiVault"), "locked form offers an unlock action");
assert.ok(!suggestionRoot.textContent.includes("ada@example.com"), "locked panel reveals no saved usernames");
assert.ok(!suggestionRoot.querySelector('input[type="password"]'), "master-password input is never inserted into the website DOM");
suggestionRoot.querySelector(".row").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
await wait(30);
assert.equal(unlockOpenRequests, 0, "synthetic clicks cannot launch a secure unlock window");
assert.equal(fillRequests.length, 4, "locked action never requests a credential fill");
vaultLocked = false;

// A signup form alone must not receive an existing password.
window.document.getElementById("login").remove();
window.document.getElementById("shadow-host").remove();
window.document.getElementById("email-only").remove();
const signupOnly = send({
  type: "flexivault:fill",
  username: "ada@example.com",
  password: "s3cret-value",
});
assert.equal(signupOnly.response.ok, false);
assert.equal(signupOnly.response.filled, 0);
assert.equal(window.document.getElementById("new-password").value, "");

// The popup re-injects content.js after an extension update or reload. A tab
// can still hold the previous instance, so the new instance must supersede it
// instead of bailing out on a global "already loaded" flag. The old bridge must
// become inert, and the new one must fill normally.
const reinjectForm = window.document.createElement("form");
reinjectForm.innerHTML = `
  <input id="late-email" type="email" name="email" autocomplete="username" />
  <input id="late-password" type="password" name="password" />
`;
window.document.body.append(reinjectForm);

const staleListener = listener;
const listenerCount = listeners.length;
window.eval(source);
assert.equal(
  listeners.length,
  listenerCount + 1,
  "re-injection registers a fresh bridge"
);
assert.equal(
  staleListener({ type: "flexivault:fill", username: "x", password: "y" }, {}, () => {}),
  undefined,
  "the superseded bridge is inert"
);

const reinjectedFill = send({
  type: "flexivault:fill",
  username: "ada@example.com",
  password: "s3cret-value",
});
assert.equal(reinjectedFill.response.ok, true);
assert.equal(window.document.getElementById("late-email").value, "ada@example.com");
assert.equal(window.document.getElementById("late-password").value, "s3cret-value");

console.log("Content-script checks passed.");
dom.window.close();
