# FlexiVault browser extension

A companion to the FlexiVault mobile app. It unlocks the same end-to-end
encrypted vault in a compact popup or a dedicated full-page tab, suggests saved
logins and live TOTP codes directly on matching forms, and fills them when you
choose an item. It can also offer to save or update a login after a trusted form
submit. Creating and editing other item types stays on mobile.

Manifest V3, plain ES modules, no build step and no remote code.

## Install (unpacked)

1. Open `chrome://extensions` (Chrome, Edge or Brave).
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this `extension/` directory.
4. In the mobile app, open **Settings → Server**, connect your self-hosted
   server, and create the account there. The extension does not register
   accounts.
5. Click the FlexiVault toolbar icon, enter the server URL, the same email and
   master password, plus the 6-digit code if account 2FA is enabled. Use
   **Full vault** in the popup for a responsive page; both views share the same
   session and encrypted cache.

`http://` is assumed when no scheme is entered, which is convenient for a LAN
server such as `192.168.1.20:8787`. Use `https://` for anything reachable from
the internet.

## What it does

- Connect to any FlexiVault server and cache the encrypted vault locally.
- Unlock with the master password; verify it offline with a key check.
- Quick unlock (1.0.4), set up under **Settings → Quick unlock**:
  - **Authenticator code** — unlock with your server account's 2FA code. Needs
    server 2FA turned on (mobile app → Settings → Server).
  - **Passkey** — unlock with Windows Hello, Touch ID, a phone or a security
    key that supports the WebAuthn PRF extension.
  Both appear in the toolbar popup and in the locked-form unlock window. The
  master password always works.
- Unlock directly from a locked login form. The inline action opens a small
  browser-owned FlexiVault window and returns to the same form automatically;
  users do not need to open the toolbar popup or full vault page.
- Search and filter logins, cards, secure notes, identities and 2FA items in the
  popup or a responsive full-page vault tab.
- Suggest saved logins inline when a matching login field gets focus. The
  suggestion contains only a name and username; the password is decrypted and
  sent to the content script only after you choose it.
- Suggest live TOTP codes inline on `autocomplete="one-time-code"` and other
  recognisable code fields.
- Reveal or copy passwords, card numbers, CVVs, identities and notes.
- Generate live TOTP codes with a countdown and copy them.
- Autofill the active tab from the popup, but only when its hostname matches the
  saved site.
- Offer to save or update a login after a trusted form submit. The pending
  credential is encrypted with the vault key in memory-backed session storage so
  the prompt can survive a full-page navigation. The encrypted row is written to
  the local cache first, marked dirty, then pushed to the configured server with
  a revision conflict merge.
- Open the saved website and sync on demand.
- Auto-lock after 15 idle minutes, keeping the bearer token for a silent
  re-authentication on the next unlock.
- Disconnect this browser, removing the cached vault, token and config.

Cards, identities and notes are view-only here; edit them on mobile.

## Development

There is no bundler. The popup and full vault page are module scripts, the
background worker is a module, and the content script is a classic script; all
are loaded directly by the browser. After editing, press the reload button on
`chrome://extensions`, reopen the popup or vault tab, and reload any page you
are testing inline suggestions on.

```bash
cd extension

npm run check   # syntax, manifest, pages, icons, fonts and CSP checks
npm test        # content script + background worker + popup/full-page E2E
npm run icons   # regenerate the PNG icons
```

`npm test` uses the real server from `../server`, the extension's own crypto,
and jsdom. jsdom is available from the repository root's dev dependencies
(`npm install` at the root); the extension itself has no runtime dependencies.

The optional real-Chromium form-unlock test also checks a page with
`frame-src 'none'`, wrong-password clearing, cross-window capability binding,
navigation/timeout/lock races, and the successful return-to-form fill:

```bash
# From the repository root:
npm install --no-save playwright
npx playwright install chromium
node extension/scripts/inline-unlock-browser-test.mjs
```

## Package and publish

A release tag attaches `FlexiVault-Extension-<version>.zip` and its SHA-256
checksum to the GitHub Release. The zip contains only the runtime files, with
`manifest.json` at its root. Build the same package locally with the
PowerShell/Linux commands in [`STORE.md`](STORE.md).

Chromium stores still require a manual listing and review. [`STORE.md`](STORE.md)
covers the Chrome Web Store and Microsoft Edge Add-ons submission, the exact
listing copy, permission justifications, data-use answers, screenshots, and the
reviewer demo account. Firefox is not supported yet.

### Layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 permissions, action, background worker, content script, CSP |
| `popup.html` / `popup.css` | Popup shell and shared design system |
| `vault.html` | Dedicated full-page vault shell (reuses `popup.js`/`popup.css`) |
| `popup.js` | View state, connect/unlock/lock/sync, copy, TOTP, autofill, full page |
| `background.js` | Host-matched suggestions, on-demand decryption and TOTP fills |
| `unlock.html` / `unlock.css` / `unlock.js` | Secure browser-owned form unlock window |
| `src/inline-unlock.js` | Offline key check and cached-envelope validation |
| `src/crypto.js` | PBKDF2-SHA256, AES-256-GCM envelopes, key check |
| `src/api.js` | Server client and URL normalisation |
| `src/otp.js` | RFC 6238 TOTP in WebCrypto |
| `src/store.js` | `chrome.storage` helpers, session freshness |
| `src/presentation.js` | Formatting, palettes, escaping, host matching |
| `src/ui.js` | Escaped HTML templates for every view |
| `content.js` | Autofill bridge and inline suggestion panel |
| `fonts/`, `icons/` | Local assets (no network requests) |

## Security model

- The master password never leaves the extension's trusted pages. PBKDF2-SHA256
  (210,000 rounds, salt and iteration count from the server) produces 64 bytes:
  the first 32 are the AES-256-GCM vault key, the second 32 are hashed into the
  `authHash` sent to the server.
- While locked, a website receives only `configured: true, locked: true`; no item
  IDs, names or usernames. Choosing **Unlock FlexiVault** creates a two-minute,
  single-use capability bound to the originating tab, document, URL, vault
  configuration and browser-owned unlock window. Password submission is
  accepted only from that top-level `chrome-extension://` page. The website
  cannot read the password control or its keystrokes. Navigation, cancellation,
  explicit lock, configuration changes and timeout invalidate the capability.
- Quick unlock never sends the vault key or master password anywhere. The
  vault key is wrapped locally with AES-256-GCM:
  - Code unlock: the wrapping key is HKDF of a random 256-bit share the server
    stores (encrypted at rest) and releases only for this browser's device
    secret plus a valid, never-reused TOTP code. Five wrong codes delete the
    share; it expires after 30 days and is renewed silently on a master-password
    unlock in the last week. Disabling server 2FA revokes every browser.
  - Passkey unlock: the wrapping key is HKDF of the authenticator's PRF output
    for a random salt; user verification is required. Nothing leaves the device.
  WebAuthn runs in the browser-owned unlock window, not the toolbar popup,
  because the OS dialog would close the popup.
- Vault items are decrypted in the popup/full-page UI and in the background
  worker while the session is unlocked. The local cache in
  `chrome.storage.local` contains ciphertext envelopes, never plaintext.
- Inline suggestion responses contain item metadata (id, name, username, and OTP
  issuer/label), never a password or code. The worker decrypts and returns a
  password or TOTP code only after the user selects a suggestion, and re-checks
  the sender's hostname first.
- The derived key lives in `chrome.storage.session`, which is memory-backed,
  unavailable to content scripts, and cleared when the browser exits.
- `keyCheck` (SHA-256 of the vault key) rejects a wrong master password before
  any decryption or network request.
- Inline suggestions match when the active hostname is the saved hostname or a
  subdomain of it. A saved subdomain is not suggested on its parent domain, and
  look-alikes such as `acme.test.evil.com` are rejected. The popup's manual
  fill keeps the existing symmetric subdomain rule and only acts on the tab the
  user explicitly selected.
- The content script reads the fields it is filling, shows the suggestion panel
  in a closed, isolated shadow root, and sends the field kind to the worker. It
  never receives passwords while listing suggestions and exposes no
  page-accessible API. After a trusted form submit it sends the submitted login
  to the worker, which keeps it encrypted with the vault key in
  `chrome.storage.session` until the prompt is saved, dismissed, or expires. The
  page never receives the pending password back.
- The background worker contacts only the configured server, for encrypted sync
  and save/update. Sign-in and connection setup remain in the popup.
- Clipboard writes happen only after an explicit click.
- No analytics, telemetry, remote fonts, or remote scripts.

### Permissions

| Permission | Why |
| --- | --- |
| `storage` | Config, encrypted cache, session key/token |
| `activeTab` | Read the active URL for popup autofill and message the page after a click |
| `scripting` | Inject the content script into a tab that was already open before the extension was installed or reloaded, only after an explicit fill click |
| `clipboardWrite` | Copy secrets on demand |
| `http://*/*`, `https://*/*` | Inject the autofill content script and show save/update prompts. Network requests go only to the server URL configured by the user, for sync and save/update. |

The broad host permission is required because autofill must work on any site
the user saves. The extension only contacts the server URL configured by the
user. The content script runs on every http(s) page but only reacts to focus on
password, username and one-time-code fields, or to a trusted form submit that
offers a save/update prompt.

### Known limitations

- The extension can save and update logins, but it cannot create or edit cards,
  notes, identities, folders, TOTP seeds or other item types, delete items, or
  generate passwords.
- Sync normally pulls. After a save/update it writes the encrypted row locally
  and pushes with the same revision conflict merge; it is not a general
  full-vault editor.
- Inline suggestions require an unlocked session, but a locked form can start a
  local unlock without opening the toolbar popup. The content script recognises
  login, username and common one-time-code fields, including fields inside open
  shadow roots and email-only first-step sign-in pages. It cannot see closed
  shadow roots, fields inside iframes, split one-character OTP boxes, or
  card/identity/CVC fields.
- A save prompt can reappear after a full-page navigation on the originating
  site, including a parent domain or a `www` variant. Cross-site SSO redirects do
  not show it, because returning the pending password to another site would leak
  it.
- Inline suggestions are automatic, not a browser-native autofill provider, so
  they do not appear in Chrome's own autofill menu or on PDFs/browser UI.
- Host matching is suffix-based, not a public-suffix check. Inline suggestions
  accept a saved `example.com` on `login.example.com` but not the reverse. The
  popup's explicit fill accepts either direction.
- JavaScript cannot reliably zero memory. Locking drops references and the
  session-storage entry, but the old key may linger in a renderer or worker heap
  until garbage collection.
- The popup and full page are not hardened against a compromised browser
  profile or a malicious extension with storage access.
- Account creation, password changes, recovery and 2FA setup remain in the
  mobile app (2FA setup also exists in the app's server settings).
