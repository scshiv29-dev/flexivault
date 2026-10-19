/**
 * Static sanity checks for the unpacked extension.
 * Run: node scripts/check.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const errors = [];

async function exists(relative) {
  try {
    const info = await stat(path.join(root, relative));
    return info.isFile();
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relative)));
    else files.push(relative);
  }
  return files;
}

const jsFiles = (await walk(".")).filter(
  (file) =>
    (file.endsWith(".js") || file.endsWith(".cjs")) &&
    !file.startsWith("node_modules")
);

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    errors.push(`${file}: ${(result.stderr || result.stdout).trim()}`);
  }
}

const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.action.default_popup, "popup.html");
assert.equal(
  manifest.background?.service_worker,
  "background.js",
  "inline suggestions need a background service worker"
);
assert.equal(
  manifest.background?.type,
  "module",
  "the background worker imports the shared crypto modules"
);
if (!(await exists("background.js"))) errors.push("missing background.js");

for (const size of [16, 32, 48, 128]) {
  const icon = manifest.icons?.[String(size)];
  if (!icon || !(await exists(icon))) errors.push(`missing icon ${size}`);
  if (manifest.action.default_icon?.[String(size)] !== icon) {
    errors.push(`action icon ${size} differs from manifest icon`);
  }
}

if (!(await exists("popup.html"))) errors.push("missing popup.html");
if (!(await exists("vault.html"))) errors.push("missing vault.html");
if (!(await exists("popup.css"))) errors.push("missing popup.css");

for (const script of manifest.content_scripts ?? []) {
  for (const file of script.js ?? []) {
    if (!(await exists(file))) errors.push(`missing content script ${file}`);
  }
}

for (const page of ["popup.html", "vault.html"]) {
  if (!(await exists(page))) continue;
  const html = await readFile(path.join(root, page), "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const reference = match[1];
    if (/^(https?:)?\/\//.test(reference) || reference.startsWith("data:")) {
      errors.push(`remote asset referenced in ${page}: ${reference}`);
    } else if (!(await exists(reference))) {
      errors.push(`${page} references missing file ${reference}`);
    }
  }
}

const css = await readFile(path.join(root, "popup.css"), "utf8");
for (const match of css.matchAll(/url\("([^"]+)"\)/g)) {
  if (!(await exists(match[1]))) errors.push(`popup.css references missing file ${match[1]}`);
}

if (!css.includes("width: 384px") || !css.includes("height: 580px")) {
  errors.push("popup.css should pin the popup viewport to 384×580");
}
if (!css.includes("html.fullpage") || !css.includes("body.fullpage")) {
  errors.push("popup.css should opt vault.html into a responsive full-page layout");
}

const csp = manifest.content_security_policy?.extension_pages ?? "";
if (!csp.includes("script-src 'self'")) errors.push("CSP must restrict scripts to 'self'");

const permissions = new Set(manifest.permissions ?? []);
for (const required of ["storage", "activeTab", "clipboardWrite"]) {
  if (!permissions.has(required)) errors.push(`missing permission ${required}`);
}

if (errors.length > 0) {
  console.error("Extension checks failed:\n");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Extension checks passed — ${jsFiles.length} scripts, ${manifest.icons ? 4 : 0} icons.`);
