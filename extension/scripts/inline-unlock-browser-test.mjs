/** Real Chromium extension test. Optional Playwright installation; set
 * PLAYWRIGHT_MODULE_PATH to its index.mjs to keep test tooling out of runtime. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as vaultCrypto from "../src/crypto.js";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE_PATH).href : "playwright");
const extension = fileURLToPath(new URL("..", import.meta.url));
const output = process.env.FLEXIVAULT_TEST_OUTPUT ?? path.join(os.tmpdir(), "flexivault-inline-unlock");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(output, "browser-profile-"));
const server = createServer((_req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'none'",
  });
  res.end(`<!doctype html><html lang="en"><title>Sign in to Acme</title>
    <style>body{font:16px system-ui;background:#f6f7f9;color:#1b2420;padding:48px 24px}form{max-width:380px;margin:0 auto}label{display:block;margin:16px 0 6px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #64746c;border-radius:8px}h1{font-size:28px}</style>
    <form><h1>Sign in to Acme</h1><label for="email">Email</label><input id="email" type="email" autocomplete="username"><label for="password">Password</label><input id="password" type="password" autocomplete="current-password"></form>
    <script>window.pageKeys=[];document.addEventListener('keydown',e=>window.pageKeys.push(e.key));</script></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://localhost:${server.address().port}/login`;
const context = await chromium.launchPersistentContext(profile, {
  headless: true, channel: "chromium", viewport: { width: 1100, height: 760 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const salt = vaultCrypto.bytesToBase64(new Uint8Array(16).fill(42));
  const derived = await vaultCrypto.deriveKeys("browser-test-master", salt);
  const key = await vaultCrypto.importVaultKey(derived.encryptionKey);
  const item = { id: "browser-test-login", type: "login", name: "Acme Portal",
    username: "ada@example.com", password: "fixture-login-secret", urls: ["http://localhost"], updatedAt: 1 };
  const fixture = { "flexivault.config": { email: "fixture@example.com", serverUrl: "http://localhost",
    kdfSalt: salt, kdfIterations: 210000, keyCheck: await vaultCrypto.keyCheck(derived.encryptionKey) },
    "flexivault.cache": { items: [{ id: item.id, data: await vaultCrypto.encryptItem(key, item) }], revision: 1, dirty: true } };
  await worker.evaluate(async (fixture) => {
    await chrome.storage.local.set(fixture);
    await chrome.storage.session.set({ "flexivault.session": { token: "fixture-token" } });
  }, fixture);
  const page = await context.newPage();
  await page.goto(url);
  const email = page.locator("#email");
  await email.click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, "locked-desktop.png") });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const unlockPage = context.pages().find(p => p.url().includes("/unlock.html")) ??
    await context.waitForEvent("page", { predicate: p => p.url().includes("/unlock.html") });
  await unlockPage.setViewportSize({ width: 400, height: 500 });
  await unlockPage.locator("#master-password").waitFor({ state: "visible" });
  await page.evaluate(() => { window.pageKeys = []; });
  assert.equal(await page.locator("#master-password").count(), 0,
    "master-password control never enters the website DOM");
  await unlockPage.locator("#master-password").pressSequentially("wrong-password");
  assert.deepEqual(await page.evaluate(() => window.pageKeys), [], "master-password keystrokes never reach the parent website");
  await unlockPage.getByRole("button", { name: "Unlock", exact: true }).click();
  await unlockPage.locator("#status").filter({ hasText: "incorrect" }).waitFor();
  assert.equal(await email.inputValue(), "", "incorrect password never fills the page");
  assert.equal(await unlockPage.locator("#master-password").inputValue(), "", "failed master password is cleared");
  await unlockPage.screenshot({ path: path.join(output, "unlock-desktop-error.png") });
  await unlockPage.setViewportSize({ width: 390, height: 500 });
  await unlockPage.screenshot({ path: path.join(output, "unlock-mobile-error.png") });
  await unlockPage.locator("#master-password").fill("browser-test-master");
  const closePromise = unlockPage.waitForEvent("close");
  await unlockPage.getByRole("button", { name: "Unlock", exact: true }).click();
  await closePromise;
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("password").value === "fixture-login-secret");
  assert.equal(await email.inputValue(), "ada@example.com");
  assert.equal(context.pages().filter(p => /popup.html|vault.html/.test(p.url())).length, 0,
    "unlock and fill never opened a popup or vault tab");
  const dirty = await worker.evaluate(async () => (await chrome.storage.local.get("flexivault.cache"))["flexivault.cache"].dirty);
  assert.equal(dirty, true, "offline encrypted cache remains dirty after inline unlock");
  console.log(`Real Chromium inline unlock passed. Screenshots: ${output}`);
} finally {
  await context.close();
  await new Promise(resolve => server.close(resolve));
}
