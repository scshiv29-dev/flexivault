/**
 * Builds the Firefox version of the extension into dist/firefox.
 *
 * Firefox runs the same code, but its manifest differs from Chrome's:
 * - the background runs as an event page (`background.scripts`), since
 *   Firefox does not support extension service workers;
 * - `browser_specific_settings.gecko` sets the permanent add-on ID, the
 *   minimum Firefox version and the self-hosted `update_url`. Unlisted
 *   (self-distributed) add-ons are signed by addons.mozilla.org but update
 *   from that URL instead of from the store.
 *
 * Run:
 *   node scripts/build-firefox.mjs
 *   node scripts/build-firefox.mjs --updates <signed.xpi> <download-url> <out.json>
 *
 * The second form writes the updates.json manifest that Firefox polls.
 */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** The permanent add-on ID. Changing it makes Firefox treat it as a new add-on. */
export const GECKO_ID = "flexivault@scshiv29-dev.github.io";
/** Firefox 140 is the current ESR and the first with data_collection_permissions. */
export const GECKO_MIN_VERSION = "140.0";
const REPOSITORY = process.env.GITHUB_REPOSITORY || "scshiv29-dev/flexivault";
/** Stable URL: always the updates.json attached to the latest GitHub release. */
export const UPDATE_URL =
  process.env.FLEXIVAULT_FIREFOX_UPDATE_URL ||
  `https://github.com/${REPOSITORY}/releases/latest/download/firefox-updates.json`;

/** Files shipped in the extension, the same set as the Chrome zip. */
export const PACKAGE_FILES = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "vault.html",
  "unlock.html",
  "unlock.css",
  "unlock.js",
  "src",
  "fonts",
  "icons",
];

export function firefoxManifest(chrome, { updateUrl = UPDATE_URL } = {}) {
  const manifest = structuredClone(chrome);
  delete manifest.minimum_chrome_version;
  manifest.background = {
    scripts: [chrome.background.service_worker],
    type: chrome.background.type,
  };
  manifest.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
      update_url: updateUrl,
      // Saved logins and the account token go only to the sync server the
      // user configures, never to the developer, but Mozilla counts any data
      // that leaves the browser.
      data_collection_permissions: { required: ["authenticationInfo"] },
    },
  };
  return manifest;
}

/** The updates.json Firefox reads from `update_url`. */
export function updatesManifest({ version, updateLink, sha256 }) {
  return {
    addons: {
      [GECKO_ID]: {
        updates: [
          {
            version,
            update_link: updateLink,
            update_hash: `sha256:${sha256}`,
            applications: { gecko: { strict_min_version: GECKO_MIN_VERSION } },
          },
        ],
      },
    },
  };
}

async function build() {
  const out = path.join(root, "dist", "firefox");
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  for (const entry of PACKAGE_FILES) {
    if (entry === "manifest.json") continue;
    await cp(path.join(root, entry), path.join(out, entry), { recursive: true });
  }
  const chrome = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const manifest = firefoxManifest(chrome);
  await writeFile(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Firefox build ${manifest.version} written to ${path.relative(process.cwd(), out) || "."}`);
}

async function writeUpdates(xpi, updateLink, outFile) {
  if (!xpi || !updateLink || !outFile) {
    throw new Error("usage: build-firefox.mjs --updates <signed.xpi> <download-url> <out.json>");
  }
  const { version } = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  const sha256 = createHash("sha256").update(await readFile(xpi)).digest("hex");
  const updates = updatesManifest({ version, updateLink, sha256 });
  await writeFile(outFile, `${JSON.stringify(updates, null, 2)}\n`);
  console.log(`updates.json for ${version} written to ${outFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [flag, ...rest] = process.argv.slice(2);
  await (flag === "--updates" ? writeUpdates(...rest) : build());
}
