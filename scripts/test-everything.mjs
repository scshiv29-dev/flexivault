#!/usr/bin/env node
/**
 * FlexiVault full-stack manual test launcher.
 *
 * One command starts everything:
 *   - a local FlexiVault sync server with an isolated data directory
 *   - a seeded, end-to-end encrypted demo account and vault
 *   - the Metro dev server (Expo Go or a native development build)
 *   - the local autofill demo page
 *   - Chrome (or Edge) with the unpacked extension loaded
 *
 * The demo account is created with the same PBKDF2/AES-GCM scheme the mobile
 * app and extension use, then verified with the extension's own crypto module.
 *
 * Usage:
 *   node scripts/test-everything.mjs
 *   node scripts/test-everything.mjs --check       # smoke-test, then exit
 *   node scripts/test-everything.mjs --fresh       # wipe test data and re-seed
 *   node scripts/test-everything.mjs --no-browser  # server + Expo only
 *   node scripts/test-everything.mjs --no-expo     # server + extension only
 *   node scripts/test-everything.mjs --help
 */

import { spawn, spawnSync } from "node:child_process";
import {
  createCipheriv,
  createHash,
  createHmac,
  pbkdf2Sync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import {
  createConnection,
  createServer as createTcpServer,
} from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

/* ------------------------------ constants ------------------------------ */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, ".manual-test");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SERVER_DIR = path.join(ROOT, "server");
const SERVER_ENTRY = path.join(SERVER_DIR, "src", "index.js");
const SERVER_DATA = path.join(DATA_DIR, "server-data");
const EXTENSION_DIR = path.join(ROOT, "extension");
const EXPO_BIN = path.join(ROOT, "node_modules", "expo", "bin", "cli");

const DEMO_EMAIL = "demo@flexivault.test";
const DEMO_PASSWORD = "flexivault-demo-2026";
const DEMO_LOGIN_PASSWORD = "demo-login-password-42!";
const SERVER_NAME = "FlexiVault Manual Test";
const KDF_ITERATIONS = 210_000;
const AUTH_PERSONALISATION = Buffer.from("flexivault:auth:v1", "utf8");
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const COLOR = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code, value) => (COLOR ? `\x1b[${code}m${value}\x1b[0m` : value);
const bold = (value) => paint("1", value);
const dim = (value) => paint("2", value);
const cyan = (value) => paint("36", value);
const green = (value) => paint("32", value);
const yellow = (value) => paint("33", value);
const red = (value) => paint("31", value);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------- state -------------------------------- */

let state = null;
let shutdownStarted = false;
let serverChild = null;
let expoChild = null;
let browserChild = null;
let demoServer = null;
let cdpClient = null;
const recentServerLog = [];

function parseArgs(argv) {
  const options = {
    check: false,
    fresh: false,
    browser: true,
    expo: true,
    help: false,
    serverPort: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.split("=", 2);

    switch (flag) {
      case "--check":
        options.check = true;
        break;
      case "--fresh":
        options.fresh = true;
        break;
      case "--no-browser":
        options.browser = false;
        break;
      case "--no-expo":
        options.expo = false;
        break;
      case "--server-port": {
        const value = inlineValue ?? argv[index + 1];
        if (inlineValue === undefined) index += 1;
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new Error("--server-port must be a TCP port between 1 and 65535");
        }
        options.serverPort = port;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(
          `Unknown option "${arg}". Run with --help to see the available options.`
        );
    }
  }

  return options;
}

function printHelp() {
  console.log(`${bold("FlexiVault full-stack manual test")}

Usage:
  node scripts/test-everything.mjs [options]
  npm run test:everything            (same as above, no options)

Options:
  --check            Start everything, verify it, then shut it all down.
  --fresh            Delete .manual-test/ (server data, state, browser profile).
  --server-port N    Prefer a specific server port (must be free).
  --no-browser       Do not launch Chrome/Edge or load the extension.
  --no-expo          Do not start the Expo dev server.
  -h, --help         Show this help.

Pass options directly to node: some npm versions consume flags such as --help
or --check before they reach the script.

The launcher creates an isolated test vault; it never touches server/data or
your normal browser profile. The demo credentials are printed at startup.
`);
}

function printBanner() {
  console.log("");
  console.log(bold(cyan("  FlexiVault · full-stack manual test")));
  console.log(dim("  server + encrypted demo vault + Expo + browser extension"));
  console.log("");
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function saveState() {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/* -------------------------------- ports -------------------------------- */

function portAcceptsConnections(port, host) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function portCanBind(port, host) {
  return new Promise((resolve) => {
    const probe = createTcpServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true));
    });
  });
}

/**
 * Windows can let two sockets bind the same port with SO_REUSEADDR, so a bind
 * probe alone is not enough. Treat a port as busy if either loopback address
 * already accepts connections; Docker/Compose proxies are caught this way.
 */
async function portIsFree(port) {
  if (await portAcceptsConnections(port, "127.0.0.1")) return false;
  if (await portAcceptsConnections(port, "::1")) return false;
  return portCanBind(port, "0.0.0.0");
}

async function findFreePort(start, attempts = 50) {
  for (let port = start; port < start + attempts; port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`Could not find a free TCP port starting at ${start}.`);
}

async function waitForPort(port, host, timeoutMs, getChild, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const child = getChild?.();
    if (child && child.exitCode !== null) {
      throw new Error(`${label} exited before it started listening (code ${child.exitCode}).`);
    }
    const connected = await new Promise((resolve) => {
      const socket = createConnection({ port, host });
      const done = (value) => {
        socket.destroy();
        resolve(value);
      };
      socket.setTimeout(1000, () => done(false));
      socket.once("connect", () => done(true));
      socket.once("error", () => done(false));
    });
    if (connected) return;
    await sleep(300);
  }
  throw new Error(`${label} did not start listening on ${host}:${port} in time.`);
}

/* ------------------------------ networking ----------------------------- */

async function apiRequest(baseUrl, pathname, { method = "GET", token, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, ok: response.ok, payload };
}

function lanAddresses() {
  const addresses = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family =
        typeof entry.family === "string"
          ? entry.family
          : entry.family === 4
            ? "IPv4"
            : "";
      if (family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      addresses.push({ name, address: entry.address });
    }
  }

  const score = ({ address }) => {
    if (address.startsWith("192.168.")) return 0;
    if (address.startsWith("10.")) return 1;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
    return 3;
  };
  return addresses.sort((left, right) => score(left) - score(right));
}

/* ------------------------------- crypto -------------------------------- */

function deriveKeysNode(password, kdfSaltB64, iterations = KDF_ITERATIONS) {
  const salt = Buffer.from(kdfSaltB64, "base64");
  if (salt.length < 16) throw new Error("The test KDF salt is invalid.");

  const material = pbkdf2Sync(
    Buffer.from(password.normalize("NFKC"), "utf8"),
    salt,
    iterations,
    64,
    "sha256"
  );
  const encryptionKey = material.subarray(0, 32);
  const authMaterial = material.subarray(32);
  const authHash = createHash("sha256")
    .update(Buffer.concat([authMaterial, AUTH_PERSONALISATION]))
    .digest("base64");

  return { encryptionKey, authHash, kdfSalt: kdfSaltB64, kdfIterations: iterations };
}

function encryptItemNode(encryptionKey, item) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(item), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${nonce.toString("base64")}.${Buffer.concat([ciphertext, tag]).toString("base64")}`;
}

function demoItems(now, demoPort) {
  const demoUrl = `http://127.0.0.1:${demoPort}`;
  return [
    {
      id: randomUUID(),
      type: "login",
      name: "Demo login · local test page",
      username: "demo@flexivault.test",
      password: DEMO_LOGIN_PASSWORD,
      urls: [demoUrl],
      notes:
        "Seeded by scripts/test-everything.mjs. Use this item to test reveal, copy and autofill on the local demo page.",
      totp: {
        secret: DEMO_TOTP_SECRET,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        issuer: "FlexiVault",
        label: "demo@flexivault.test",
      },
      folder: "Demo",
      favorite: true,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: randomUUID(),
      type: "note",
      name: "Welcome to the test vault",
      username: "",
      urls: [],
      notes:
        "This secure note was encrypted on the launcher with AES-256-GCM.\n\nIf you can read it on mobile and in the extension, the shared vault key is working.\n\nTry editing this note on mobile, then press Sync in the extension.",
      folder: "Demo",
      favorite: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: randomUUID(),
      type: "card",
      name: "Demo Visa",
      username: "",
      urls: [],
      notes: "Stripe's test card number. Not a real card.",
      card: {
        number: "4242 4242 4242 4242",
        holder: "ADA LOVELACE",
        expiry: "12/30",
        cvv: "123",
        brand: "Visa",
      },
      folder: "Demo",
      favorite: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    {
      id: randomUUID(),
      type: "identity",
      name: "Ada Lovelace",
      username: "",
      urls: [],
      notes: "",
      identity: {
        fullName: "Ada Lovelace",
        email: "ada@flexivault.test",
        phone: "+44 20 7946 0958",
        address: "12 St James's Square, London",
        company: "Analytical Engines Ltd",
        passport: "X1234567",
      },
      folder: "Demo",
      favorite: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];
}

/* ------------------------------ demo site ------------------------------ */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(secret) {
  const clean = String(secret ?? "")
    .toUpperCase()
    .replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const output = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error("The demo TOTP secret is not valid base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function counterBytes(counter) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  return buffer;
}

function totpAtCounter(secret, counter) {
  const digest = createHmac("sha1", base32Decode(secret))
    .update(counterBytes(counter))
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function currentTotp(secret, timestamp = Date.now()) {
  return totpAtCounter(secret, Math.floor(timestamp / 1000 / 30));
}

function verifyTotp(secret, code, timestamp = Date.now()) {
  const clean = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(timestamp / 1000 / 30);
  return [-1, 0, 1].some(
    (offset) => totpAtCounter(secret, counter + offset) === clean
  );
}

function demoPage({ eyebrow, title, intro, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Demo login · FlexiVault</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: radial-gradient(circle at 15% 10%, #10261f 0, #070c0a 45%, #050807 100%);
    color: #e9f5ef;
    font-family: ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 32px;
  }
  main {
    width: min(430px, 100%); padding: 30px; border-radius: 22px;
    background: rgba(13, 24, 20, 0.88); border: 1px solid #243b32;
    box-shadow: 0 24px 80px rgba(0, 0, 0, 0.45);
  }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 26px; }
  .mark {
    width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center;
    background: #6ee7b7; color: #06231a; font-weight: 800; font-family: ui-monospace, monospace;
  }
  .brand strong { letter-spacing: -0.02em; }
  .brand span { color: #8fb3a5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; }
  .eyebrow {
    margin: 0 0 6px; color: #6ee7b7; font-size: 10px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase;
  }
  h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.05; letter-spacing: -0.04em; }
  p { color: #a6c2b5; line-height: 1.6; font-size: 14px; }
  .intro { margin: 0 0 24px; }
  form { display: grid; gap: 8px; }
  label { font-size: 10px; font-weight: 700; letter-spacing: 0.14em; color: #8fb3a5; margin-top: 8px; }
  input {
    width: 100%; padding: 14px 15px; border-radius: 12px;
    border: 1px solid #2a4539; background: #09120e; color: #eef9f3;
    font: inherit; outline: none;
  }
  input:focus { border-color: #6ee7b7; box-shadow: 0 0 0 3px rgba(110, 231, 183, 0.12); }
  button {
    margin-top: 14px; padding: 14px 16px; border: 0; border-radius: 12px;
    background: #6ee7b7; color: #06231a; font: inherit; font-weight: 800; cursor: pointer;
  }
  button:hover { background: #8af0c8; }
  .hint { font-size: 12px; color: #7e9d8f; margin: 18px 0 0; }
  .error {
    margin: 0; padding: 10px 12px; border-radius: 10px;
    background: #3a1d1d; border: 1px solid #6b3232;
    color: #ffb4b4; font-size: 12px; line-height: 1.5;
  }
  .account { margin: 0; color: #cfe3d9; font-size: 13px; }
  .account strong { color: #eef9f3; }
  .result dl { display: grid; gap: 10px; margin: 18px 0; }
  .result dl div { background: #09120e; border: 1px solid #243b32; border-radius: 12px; padding: 12px 14px; }
  dt { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: #8fb3a5; }
  dd { margin: 5px 0 0; font-family: ui-monospace, monospace; word-break: break-all; }
  .back { display: inline-block; margin-top: 8px; color: #6ee7b7; font-weight: 700; text-decoration: none; }
  code { background: #09120e; border: 1px solid #243b32; padding: 1px 6px; border-radius: 6px; font-size: 12px; }
</style>
</head>
<body>
<main>
  <div class="brand">
    <div class="mark">F</div>
    <div><strong>FlexiVault</strong><br /><span>autofill + 2FA sandbox</span></div>
  </div>
  <p class="eyebrow">${escapeHtml(eyebrow)}</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="intro">${escapeHtml(intro)}</p>
  ${body}
</main>
</body>
</html>`;
}

function loginPage({ error = "", email = "" } = {}) {
  return demoPage({
    eyebrow: "Local test page · step 1 of 2",
    title: "Sign in to the demo.",
    intro:
      "Use the seeded FlexiVault login. When the vault is unlocked, focusing the email field should offer the saved credential and fill both fields.",
    body: `<form method="post" action="/login" autocomplete="on">
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="username" placeholder="you@example.com" value="${escapeHtml(email)}" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required />
      <button type="submit">Continue to 2FA</button>
    </form>
    <p class="hint">This page exists only to test autofill and TOTP. Nothing is persisted.</p>`,
  });
}

function otpPage({ email, error = "" } = {}) {
  return demoPage({
    eyebrow: "Local test page · step 2 of 2",
    title: "Enter your 2FA code.",
    intro:
      "The seeded login also has a TOTP secret. Focus the code field and choose the FlexiVault suggestion, or copy the live code from the extension or mobile app.",
    body: `<form method="post" action="/verify" autocomplete="on">
      <input type="hidden" name="email" value="${escapeHtml(email)}" />
      ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
      <p class="account">Signing in as <strong>${escapeHtml(email)}</strong></p>
      <label for="code">6-digit code</label>
      <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" placeholder="000000" required autofocus />
      <button type="submit">Verify and sign in</button>
    </form>
    <p class="hint">Codes rotate every 30 seconds. The server accepts one step of clock skew.</p>
    <p class="hint"><a class="back" href="/">Start over</a></p>`,
  });
}

function successPage(email) {
  return demoPage({
    eyebrow: "Local test page · complete",
    title: "2FA verified.",
    intro:
      "The local server accepted the seeded login and a current authenticator code.",
    body: `<section class="result">
      <dl>
        <div><dt>Email</dt><dd>${escapeHtml(email)}</dd></div>
        <div><dt>Second factor</dt><dd>TOTP accepted</dd></div>
      </dl>
      <p class="hint">The code was checked with the same secret stored in the FlexiVault demo item. Nothing is persisted.</p>
      <a class="back" href="/">Run it again</a>
    </section>`,
  });
}

function readForm(request, done) {
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 100_000) request.destroy();
  });
  request.on("end", () => done(new URLSearchParams(body)));
}

async function startDemoServer(port) {
  const server = createHttpServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    const send = (status, body, type = "text/html; charset=utf-8") => {
      response.writeHead(status, {
        "Content-Type": type,
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
      });
      response.end(body);
    };

    if (request.method === "GET" && url.pathname === "/") {
      send(200, loginPage());
      return;
    }

    if (request.method === "POST" && url.pathname === "/login") {
      readForm(request, (params) => {
        const email = String(params.get("email") ?? "")
          .trim()
          .toLowerCase();
        const password = String(params.get("password") ?? "");
        if (email !== DEMO_EMAIL || password !== DEMO_LOGIN_PASSWORD) {
          send(
            200,
            loginPage({
              email,
              error:
                "Use the seeded demo login. Open the FlexiVault item to copy its password.",
            })
          );
          return;
        }
        send(200, otpPage({ email: DEMO_EMAIL }));
      });
      return;
    }

    if (request.method === "POST" && url.pathname === "/verify") {
      readForm(request, (params) => {
        const email = String(params.get("email") ?? "")
          .trim()
          .toLowerCase();
        const code = String(params.get("code") ?? "");
        if (email !== DEMO_EMAIL) {
          send(
            200,
            loginPage({
              email,
              error: "Start again with the seeded demo login.",
            })
          );
          return;
        }
        if (!verifyTotp(DEMO_TOTP_SECRET, code)) {
          send(
            200,
            otpPage({
              email: DEMO_EMAIL,
              error: "That code did not match. Check the live code and try again.",
            })
          );
          return;
        }
        send(200, successPage(DEMO_EMAIL));
      });
      return;
    }

    send(404, "Not found", "text/plain; charset=utf-8");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return server;
}

async function checkDemoFlow(port) {
  const base = `http://127.0.0.1:${port}`;
  const credentials = new URLSearchParams({
    email: DEMO_EMAIL,
    password: DEMO_LOGIN_PASSWORD,
  });
  const stepOne = await fetch(`${base}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: credentials,
  });
  const stepOneHtml = await stepOne.text();
  if (!stepOneHtml.includes('autocomplete="one-time-code"')) {
    throw new Error("The demo login did not advance to the TOTP step.");
  }

  const code = currentTotp(DEMO_TOTP_SECRET);
  const stepTwo = await fetch(`${base}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: DEMO_EMAIL, code }),
  });
  const stepTwoHtml = await stepTwo.text();
  if (!stepTwoHtml.includes("TOTP accepted")) {
    throw new Error("The demo page rejected a valid TOTP code.");
  }

  const counter = Math.floor(Date.now() / 1000 / 30);
  const valid = new Set(
    [-1, 0, 1].map((offset) =>
      totpAtCounter(DEMO_TOTP_SECRET, counter + offset)
    )
  );
  let badCode = "000000";
  while (valid.has(badCode)) {
    badCode = String(Number(badCode) + 1).padStart(6, "0");
  }
  const rejected = await fetch(`${base}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: DEMO_EMAIL, code: badCode }),
  });
  const rejectedHtml = await rejected.text();
  if (rejectedHtml.includes("TOTP accepted")) {
    throw new Error("The demo page accepted an invalid TOTP code.");
  }
}

/* ------------------------------- server -------------------------------- */

function prefixLines(stream, prefix, collect) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      console.log(`${dim(`[${prefix}]`)} ${line}`);
      if (collect) {
        collect.push(line);
        if (collect.length > 60) collect.shift();
      }
    }
  });
}

function startServer(port) {
  const env = {
    ...process.env,
    HOST: "0.0.0.0",
    PORT: String(port),
    DATA_DIR: SERVER_DATA,
    REGISTRATION_OPEN: "true",
    SERVER_NAME,
    QUIET: "false",
  };
  delete env.JWT_SECRET;
  delete env.ENCRYPTION_SECRET;

  const child = spawn(
    process.execPath,
    ["--experimental-sqlite", SERVER_ENTRY],
    {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }
  );

  prefixLines(child.stdout, "server", recentServerLog);
  prefixLines(child.stderr, "server", recentServerLog);

  child.on("exit", (code) => {
    if (shutdownStarted) return;
    if (code !== 0) {
      console.error(red(`\n[server] exited unexpectedly with code ${code}.`));
      void shutdown(code ?? 1);
    }
  });

  return child;
}

async function waitForServer(port) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (serverChild?.exitCode !== null) {
      throw new Error(
        `The test server exited during startup.\n${recentServerLog.slice(-12).join("\n")}`
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (payload?.name !== SERVER_NAME) {
          throw new Error(
            `Port ${port} is already used by another server (name "${payload?.name ?? "unknown"}").\n` +
              "Close that service, or pass --server-port with a free port."
          );
        }
        return;
      }
    } catch (error) {
      if (String(error.message).includes("already used by another server")) throw error;
      // Still starting.
    }
    await sleep(250);
  }
  throw new Error("The test server did not become healthy in time.");
}

/* -------------------------------- seed --------------------------------- */

async function seedDemo(serverUrl, demoPort) {
  const keys = deriveKeysNode(DEMO_PASSWORD, state.kdfSalt);
  const prelogin = await apiRequest(serverUrl, "/api/accounts/prelogin", {
    method: "POST",
    body: { email: DEMO_EMAIL },
  });

  let token = null;
  let created = false;

  if (prelogin.status === 200) {
    if (prelogin.payload.kdfSalt !== state.kdfSalt) {
      throw new Error(
        "The local test server already has a demo account with a different KDF salt.\n" +
          "Run with --fresh to wipe .manual-test/ and create a matching account."
      );
    }
    const login = await apiRequest(serverUrl, "/api/accounts/login", {
      method: "POST",
      body: { email: DEMO_EMAIL, authHash: keys.authHash },
    });
    if (login.status !== 200) {
      throw new Error(
        `Could not sign in to the demo account (${login.status}: ${
          login.payload?.error ?? "unknown error"
        }). Run with --fresh to recreate it.`
      );
    }
    token = login.payload.token;
  } else if (prelogin.status === 404) {
    const registered = await apiRequest(serverUrl, "/api/accounts/register", {
      method: "POST",
      body: {
        email: DEMO_EMAIL,
        authHash: keys.authHash,
        kdfSalt: state.kdfSalt,
        kdfIterations: KDF_ITERATIONS,
      },
    });
    if (registered.status !== 201) {
      throw new Error(
        `Could not create the demo account (${registered.status}: ${
          registered.payload?.error ?? "unknown error"
        }).`
      );
    }
    token = registered.payload.token;
    created = true;
  } else {
    throw new Error(
      `Unexpected prelogin response: ${prelogin.status} ${
        prelogin.payload?.error ?? ""
      }`
    );
  }

  const current = await apiRequest(serverUrl, "/api/sync", { token });
  if (!current.ok) {
    throw new Error(`Could not read the demo vault: ${current.status}`);
  }

  if (current.payload.items.length === 0) {
    const now = Date.now();
    const items = demoItems(now, demoPort).map((item) => ({
      id: item.id,
      data: encryptItemNode(keys.encryptionKey, item),
    }));
    const pushed = await apiRequest(serverUrl, "/api/sync", {
      method: "PUT",
      token,
      body: { baseRevision: current.payload.revision, items },
    });
    if (!pushed.ok) {
      throw new Error(
        `Could not seed the demo vault (${pushed.status}: ${
          pushed.payload?.error ?? "unknown error"
        }).`
      );
    }
    console.log(
      green(`  Seeded ${items.length} encrypted demo items (revision ${pushed.payload.revision}).`)
    );
  } else {
    console.log(
      dim(
        `  Keeping the existing demo vault (${current.payload.items.length} items, revision ${current.payload.revision}).`
      )
    );
  }

  /* Verify with the same crypto module the browser extension uses. */
  const extensionCrypto = await import(
    pathToFileURL(path.join(EXTENSION_DIR, "src", "crypto.js")).href
  );
  const extensionKeys = await extensionCrypto.deriveKeys(DEMO_PASSWORD, state.kdfSalt);
  if (extensionKeys.authHash !== keys.authHash) {
    throw new Error("The launcher and extension derived different auth hashes.");
  }
  const vaultKey = await extensionCrypto.importVaultKey(extensionKeys.encryptionKey);
  const latest = await apiRequest(serverUrl, "/api/sync", { token });
  const first = latest.payload.items[0];
  const decrypted = await extensionCrypto.decryptItem(vaultKey, first.data);
  if (!decrypted?.name) {
    throw new Error("The extension crypto module could not decrypt the seeded vault.");
  }

  const hasDemoLogin = (
    await Promise.all(
      latest.payload.items.map((item) => extensionCrypto.decryptItem(vaultKey, item.data))
    )
  ).some((item) =>
    (item.urls ?? []).some((url) => url.includes(`127.0.0.1:${demoPort}`))
  );

  console.log(
    green("  Crypto check passed: extension module decrypted the seeded vault.")
  );

  const extensionOtp = await import(
    pathToFileURL(path.join(EXTENSION_DIR, "src", "otp.js")).href
  );
  const totpCheckAt = Date.now();
  const nodeTotp = currentTotp(DEMO_TOTP_SECRET, totpCheckAt);
  const extensionTotp = await extensionOtp.generateTotp(
    {
      secret: DEMO_TOTP_SECRET,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    },
    totpCheckAt
  );
  if (nodeTotp !== extensionTotp) {
    throw new Error(
      "The launcher and extension generated different TOTP codes for the demo secret."
    );
  }
  if (!verifyTotp(DEMO_TOTP_SECRET, nodeTotp, totpCheckAt)) {
    throw new Error("The launcher's TOTP verifier rejected its own code.");
  }
  if (
    verifyTotp(
      DEMO_TOTP_SECRET,
      nodeTotp === "000000" ? "111111" : "000000",
      totpCheckAt
    )
  ) {
    throw new Error("The launcher's TOTP verifier accepted an invalid code.");
  }
  console.log(
    green(`  TOTP check passed: launcher and extension agree (${nodeTotp}).`)
  );

  if (!hasDemoLogin) {
    console.log(
      yellow(
        `  No saved item points at http://127.0.0.1:${demoPort}; autofill will not match. ` +
          "Run with --fresh or create a login for the demo page on mobile."
      )
    );
  }

  return { created, token };
}

/* ------------------------------- browser ------------------------------- */

function findBrowser(explicitPath) {
  if (explicitPath) {
    if (!existsSync(explicitPath)) {
      throw new Error(`The browser path does not exist: ${explicitPath}`);
    }
    return explicitPath;
  }

  const candidates =
    process.platform === "win32"
      ? [
          process.env.CHROME_PATH,
          process.env.EDGE_PATH,
          path.join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
          ),
          path.join(
            process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
          ),
          path.join(
            process.env.LOCALAPPDATA ?? "",
            "Google",
            "Chrome",
            "Application",
            "chrome.exe"
          ),
          path.join(
            process.env.ProgramFiles ?? "C:\\Program Files",
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe"
          ),
          path.join(
            process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe"
          ),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
          ];

  return candidates.filter(Boolean).find((candidate) => existsSync(candidate)) ?? null;
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP connection timed out.")), 8000);
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Could not open the Chrome DevTools connection."));
      },
      { once: true }
    );
  });

  let nextId = 0;
  const pending = new Map();

  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message ?? "CDP command failed."));
    } else {
      resolve(message.result);
    }
  });

  const rejectPending = () => {
    for (const { reject } of pending.values()) {
      reject(new Error("The DevTools connection closed."));
    }
    pending.clear();
  };
  socket.addEventListener("close", rejectPending);
  socket.addEventListener("error", rejectPending);

  return {
    send(method, params = {}, timeoutMs = 20_000) {
      return new Promise((resolve, reject) => {
        const id = (nextId += 1);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP command "${method}" timed out.`));
        }, timeoutMs);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      try {
        socket.close();
      } catch {
        // Ignore.
      }
    },
  };
}

async function waitForDevTools(port) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (browserChild?.exitCode !== null) {
      throw new Error(
        "Chrome exited before its DevTools port opened. Close any FlexiVault test browser window and try again."
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) return await response.json();
    } catch {
      // Still starting.
    }
    await sleep(300);
  }
  throw new Error("Chrome did not expose its DevTools port in time.");
}

async function pageWebSocketUrl(targetId) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (
        await fetch(`http://127.0.0.1:${mainBrowserPort}/json/list`, {
          signal: AbortSignal.timeout(1000),
        })
      ).json();
      const target = targets.find((entry) => entry.id === targetId);
      if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl;
    } catch {
      // Retry.
    }
    await sleep(200);
  }
  throw new Error("Could not find the extension page in Chrome.");
}

let mainBrowserPort = null;

async function resetExtensionStorage(extensionId) {
  const created = await cdpClient.send("Target.createTarget", {
    url: `chrome-extension://${extensionId}/vault.html`,
  });
  const extensionTargetId = created.targetId;
  const pageClient = await connectCdp(await pageWebSocketUrl(extensionTargetId));

  try {
    const result = await pageClient.send("Runtime.evaluate", {
      expression:
        "(async () => { await chrome.storage.local.clear(); await chrome.storage.session.clear(); return true; })()",
      awaitPromise: true,
      returnByValue: true,
    });
    if (!result?.result?.value) {
      throw new Error("chrome.storage.clear() did not return true.");
    }
    await pageClient.send("Page.reload", { ignoreCache: true });
    await sleep(1200);
    const check = await pageClient.send("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('#serverUrl'))",
      returnByValue: true,
    });
    if (!check?.result?.value) {
      throw new Error("The full vault page did not show the server setup form.");
    }
  } finally {
    pageClient.close();
  }

  return extensionTargetId;
}

async function launchBrowser({ demoUrl, serverUrl }) {
  const executable = findBrowser();
  if (!executable) {
    console.log(
      yellow(
        "\n  No Chrome/Edge/Chromium found. The extension will not be launched automatically."
      )
    );
    return null;
  }

  const profileDir = path.join(DATA_DIR, "chrome-profile");
  await mkdir(profileDir, { recursive: true });
  const debugPort = await findFreePort(9222);
  mainBrowserPort = debugPort;

  browserChild = spawn(
    executable,
    [
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      "--enable-unsafe-extension-debugging",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-search-engine-choice-screen",
      "--hide-crash-restore-bubble",
      "about:blank",
    ],
    {
      cwd: ROOT,
      stdio: "ignore",
      windowsHide: false,
    }
  );

  browserChild.on("exit", () => {
    if (!shutdownStarted) {
      console.log(dim("\n  Chrome was closed; server and Expo are still running."));
    }
  });

  let version;
  try {
    version = await waitForDevTools(debugPort);
  } catch (error) {
    console.log(yellow(`\n  Chrome launched, but DevTools was unreachable: ${error.message}`));
    return null;
  }

  cdpClient = await connectCdp(version.webSocketDebuggerUrl);

  let extensionId;
  try {
    const loaded = await cdpClient.send("Extensions.loadUnpacked", {
      path: EXTENSION_DIR,
    });
    extensionId = loaded?.id;
    if (!extensionId) throw new Error("Chrome did not return an extension id.");
  } catch (error) {
    console.log(
      yellow(
        `\n  Could not load the extension automatically: ${error.message}\n` +
          "  Open chrome://extensions, enable Developer mode, and use Load unpacked."
      )
    );
    try {
      await cdpClient.send("Target.createTarget", { url: "chrome://extensions/" });
    } catch {
      // Ignore.
    }
    return null;
  }

  let extensionTargetId;
  try {
    extensionTargetId = await resetExtensionStorage(extensionId);
    await cdpClient.send("Target.createTarget", { url: demoUrl });
    await cdpClient.send("Target.activateTarget", { targetId: extensionTargetId });
  } catch (error) {
    console.log(
      yellow(
        `\n  The extension loaded, but its setup page could not be prepared: ${error.message}`
      )
    );
  }

  console.log(
    green(`  Chrome loaded the FlexiVault extension (${extensionId}).`)
  );
  console.log(dim(`  Demo page: ${demoUrl}`));
  console.log(dim(`  Extension server URL: ${serverUrl}`));

  return { executable, extensionId, profileDir, debugPort };
}

/* -------------------------------- expo --------------------------------- */

function startExpo(port) {
  if (!existsSync(EXPO_BIN)) {
    throw new Error("Expo CLI was not found. Run `npm install` in the project root.");
  }

  const env = { ...process.env, BROWSER: "none", EXPO_NO_TELEMETRY: "1" };
  delete env.CI;

  const child = spawn(
    process.execPath,
    [EXPO_BIN, "start", "--lan", "--port", String(port)],
    {
      cwd: ROOT,
      env,
      stdio: "inherit",
      windowsHide: false,
    }
  );

  child.on("exit", (code) => {
    if (shutdownStarted) return;
    if (code && code !== 0) {
      console.error(red(`\n[expo] exited with code ${code}.`));
    }
  });

  return child;
}

/* ------------------------------- cleanup ------------------------------- */

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  try {
    child.kill("SIGTERM");
  } catch {
    // Ignore.
  }
}

async function shutdown(code = 0) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.log(dim("\nStopping the test stack…"));

  cdpClient?.close();
  cdpClient = null;

  if (demoServer) {
    demoServer.closeAllConnections?.();
    await new Promise((resolve) => demoServer.close(resolve));
    demoServer = null;
  }

  killTree(browserChild);
  browserChild = null;
  killTree(expoChild);
  expoChild = null;
  if (serverChild) {
    killTree(serverChild);
    serverChild = null;
  }

  await sleep(350);
  console.log(dim("Stopped. Test data remains in .manual-test/ (use --fresh to reset)."));
  process.exit(code);
}

/* ------------------------------ instructions --------------------------- */

function printInstructions({ serverUrl, mobileUrl, demoUrl, lanWarning, browserReady }) {
  const browserSteps = browserReady
    ? `  1. Chrome is open with the FlexiVault full vault page loaded.
  2. Connect it to the server:
       Server:  ${serverUrl}
       Email:   ${DEMO_EMAIL}
       Password:${" "}${DEMO_PASSWORD}
  3. Open the demo login. After the vault is unlocked, focus the email
     field and choose the saved demo login to fill the form.
  4. Continue to the 2FA step, focus the code field and choose the live
     FlexiVault suggestion (or copy the code from the vault tab).
  5. Add or edit an item on mobile, press Sync in the extension, confirm it appears.`
    : `  1. Load the unpacked extension manually:
       chrome://extensions → Developer mode → Load unpacked
       Folder: ${EXTENSION_DIR}
  2. Open vault.html from the extension and connect with:
       Server:  ${serverUrl}
       Email:   ${DEMO_EMAIL}
       Password:${" "}${DEMO_PASSWORD}
  3. Open ${demoUrl}, fill the login (inline suggestion or popup
     Autofill), then complete the TOTP step.
  4. Add/change an item on mobile, press Sync in the extension, confirm it appears.`;

  console.log("");
  console.log(bold("  ┌──────────────────────────────────────────────────────────────┐"));
  console.log(bold("  │  READY — follow these steps                                  │"));
  console.log(bold("  └──────────────────────────────────────────────────────────────┘"));
  console.log("");
  console.log(bold("  Demo account (same on mobile and extension)"));
  console.log(`    Email:            ${cyan(DEMO_EMAIL)}`);
  console.log(`    Master password:  ${cyan(DEMO_PASSWORD)}`);
  console.log(`    Demo login pass:  ${cyan(DEMO_LOGIN_PASSWORD)}`);
  console.log(`    Server (desktop): ${cyan(serverUrl)}`);
  console.log(`    Server (phone):   ${cyan(mobileUrl)}`);
  console.log(`    Autofill page:    ${cyan(demoUrl)}`);
  if (lanWarning) console.log(yellow(`    ! ${lanWarning}`));
  console.log("");
  console.log(bold("  1. Mobile (Expo Go or native development build)"));
  console.log(`     Scan the QR code with Expo Go 57, or build once with \`npm run android\`.`);
  console.log(`     SDK 57 is the current Expo Go target; both clients use this Metro server.`);
  console.log(`     Tap "Sign in to a server" and enter the phone URL + demo account.`);
  console.log(`     The four seeded items should download. Check:`);
  console.log(`       • login with live TOTP and copy/reveal`);
  console.log(`       • secure note, card and identity detail views`);
  console.log(`       • add / edit / delete an item, then sync`);
  console.log(`       • scan or paste an otpauth:// code (optional)`);
  console.log("");
  console.log(bold("  2. Browser extension"));
  console.log(browserSteps);
  console.log("");
  console.log(bold("  3. Server"));
  console.log(`     Health:  ${serverUrl}/api/health`);
  console.log(`     Data:    ${SERVER_DATA}`);
  console.log(`     The server only stores scrypt verifiers and AES-GCM envelopes.`);
  console.log(
    dim("     It is reachable on your LAN for the phone; stop it when you finish testing.")
  );
  console.log("");
  console.log(dim("  Ctrl+C stops the server, Expo and the test browser."));
  console.log(dim("  Re-run with --fresh to wipe the test vault and browser profile."));
  console.log("");
}

/* --------------------------------- main -------------------------------- */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  printBanner();

  if (Number(process.versions.node.split(".")[0]) < 22) {
    throw new Error("Node 22 or newer is required (node:sqlite).");
  }
  for (const [label, target] of [
    ["server entry", SERVER_ENTRY],
    ["extension manifest", path.join(EXTENSION_DIR, "manifest.json")],
    ["Expo CLI", EXPO_BIN],
  ]) {
    if (!existsSync(target)) {
      throw new Error(
        `Missing ${label}: ${target}\nRun \`npm install\` in the project root first.`
      );
    }
  }

  if (options.fresh) {
    try {
      await rm(DATA_DIR, { recursive: true, force: true });
      console.log(dim("  Reset .manual-test/ (fresh server data and browser profile)."));
    } catch (error) {
      throw new Error(
        `Could not reset .manual-test/: ${error.message}\n` +
          "Close the FlexiVault test browser or stop a previous test run, then retry."
      );
    }
  }

  await mkdir(DATA_DIR, { recursive: true });
  state = (await loadState()) ?? {
    kdfSalt: randomBytes(16).toString("base64"),
    createdAt: Date.now(),
  };
  if (!state.kdfSalt || Buffer.from(state.kdfSalt, "base64").length < 16) {
    throw new Error("The saved .manual-test/state.json has an invalid KDF salt.");
  }

  let serverPort;
  if (options.serverPort) {
    if (!(await portIsFree(options.serverPort))) {
      throw new Error(`--server-port ${options.serverPort} is already in use.`);
    }
    serverPort = options.serverPort;
  } else if (
    state.serverPort &&
    (await portIsFree(state.serverPort))
  ) {
    serverPort = state.serverPort;
  } else {
    serverPort = await findFreePort(8787);
  }
  state.serverPort = serverPort;

  let demoPort;
  if (state.demoPort) {
    if (!(await portIsFree(state.demoPort))) {
      throw new Error(
        `Demo page port ${state.demoPort} is already in use.\n` +
          "Another copy of this test may be running. Close it, or run with --fresh to pick a new port."
      );
    }
    demoPort = state.demoPort;
  } else {
    demoPort = await findFreePort(8790);
    state.demoPort = demoPort;
  }

  await saveState();

  const serverUrl = `http://127.0.0.1:${serverPort}`;
  const demoUrl = `http://127.0.0.1:${demoPort}`;
  const addresses = lanAddresses();
  const lanIp = addresses[0]?.address ?? null;
  const mobileUrl = lanIp ? `http://${lanIp}:${serverPort}` : serverUrl;

  console.log("");
  console.log(`  Server:      ${cyan(serverUrl)}`);
  console.log(`  Demo site:   ${cyan(demoUrl)}`);

  serverChild = startServer(serverPort);
  await waitForServer(serverPort);
  console.log(green("  Server is healthy."));

  demoServer = await startDemoServer(demoPort);
  console.log(green("  Autofill demo page is ready."));

  await seedDemo(serverUrl, demoPort);

  if (options.check) {
    await checkDemoFlow(demoPort);
    console.log(green("  Demo login + 2FA flow verified."));
  }

  let lanWarning = null;
  if (lanIp) {
    try {
      const response = await fetch(`http://${lanIp}:${serverPort}/api/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) throw new Error("health check failed");
      console.log(green(`  LAN address works: http://${lanIp}:${serverPort}`));
    } catch {
      lanWarning =
        `Could not reach http://${lanIp}:${serverPort} from this computer. ` +
        "Allow Node.js through the firewall on private networks.";
    }
  } else {
    lanWarning = "No LAN IPv4 address found; a physical phone will not reach this computer.";
  }
  if (addresses.length > 1) {
    console.log(
      dim(
        `  Other interfaces: ${addresses
          .slice(1)
          .map((entry) => `${entry.address} (${entry.name})`)
          .join(", ")}`
      )
    );
  }

  let expo = null;
  let expoPort = null;
  if (options.expo) {
    expoPort = await findFreePort(8081);
  }

  let browser = null;
  if (options.browser) {
    browser = await launchBrowser({ demoUrl, serverUrl });
  }

  if (expoPort) {
    console.log("");
    expoChild = startExpo(expoPort);
    console.log(dim(`  Starting Expo on port ${expoPort}…`));
    await waitForPort(expoPort, "127.0.0.1", 90_000, () => expoChild, "Expo");
    console.log(green(`  Expo dev server is listening on ${expoPort}.`));
  }

  if (options.check) {
    console.log("");
    console.log(bold(green("  Check passed.")));
    console.log("    ✓ server health + encrypted sync");
    console.log("    ✓ seeded vault decrypts with the extension crypto");
    console.log("    ✓ demo login + TOTP page flow");
    if (browser) console.log(`    ✓ Chrome loaded extension ${browser.extensionId}`);
    else console.log(yellow("    - browser extension check skipped"));
    if (expoPort) console.log(`    ✓ Expo dev server on port ${expoPort}`);
    else console.log(yellow("    - Expo check skipped"));
    console.log("");
    await shutdown(0);
    return;
  }

  printInstructions({
    serverUrl,
    mobileUrl,
    demoUrl,
    lanWarning,
    browserReady: Boolean(browser),
  });

  if (expoChild) {
    const exitCode = await new Promise((resolve) => {
      expoChild.once("exit", (code) => resolve(code ?? 0));
    });
    await shutdown(exitCode);
    return;
  }

  // No Expo and not in check mode: keep the server + browser alive until Ctrl+C.
  await new Promise(() => {});
}

main().catch(async (error) => {
  console.error("");
  console.error(red(`Error: ${error.message}`));
  if (serverChild?.exitCode === null && recentServerLog.length) {
    console.error(dim("Last server output:"));
    for (const line of recentServerLog.slice(-10)) console.error(dim(`  ${line}`));
  }
  await shutdown(1);
});

process.on("SIGINT", () => {
  void shutdown(0);
});
process.on("SIGTERM", () => {
  void shutdown(0);
});
