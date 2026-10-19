# FlexiVault browser extension

A read-only companion to the FlexiVault mobile app. It unlocks the same
end-to-end encrypted vault in a compact popup or a dedicated full-page tab,
suggests saved logins and live TOTP codes directly on matching forms, and fills
them when you choose an item. Creating and editing items stays on mobile so
there is exactly one write path into the vault.

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

### Layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 permissions, action, background worker, content script, CSP |
| `popup.html` / `popup.css` | Popup shell and shared design system |
| `vault.html` | Dedicated full-page vault shell (reuses `popup.js`/`popup.css`) |
| `popup.js` | View state, connect/unlock/lock/sync, copy, TOTP, autofill, full page |
| `background.js` | Host-matched suggestions, on-demand decryption and TOTP fills |
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
  in a closed, isolated shadow root, and sends only the field kind to the
  worker. It never receives passwords while listing suggestions and exposes no
  page-accessible API.
- The background worker makes no network requests; sync and connect remain in
  the popup.
- Clipboard writes happen only after an explicit click.
- No analytics, telemetry, remote fonts, or remote scripts.

### Permissions

| Permission | Why |
| --- | --- |
| `storage` | Config, encrypted cache, session key/token |
| `activeTab` | Read the active URL for popup autofill and message the page after a click |
| `clipboardWrite` | Copy secrets on demand |
| `http://*/*`, `https://*/*` | Inject the autofill content script; the background worker makes no network requests |

The broad host permission is required because autofill must work on any site
the user saves. The extension only contacts the server URL configured by the
user, and only from the popup. The content script runs on every http(s) page but
only reacts to focus on password, username and one-time-code fields.

### Known limitations

- No create, edit, delete or password generation in the extension.
- Sync is pull-only: mobile pushes, the extension refreshes. It never resolves
  conflicts or writes to `/api/sync`.
- Inline suggestions need an unlocked vault. The content script recognises
  normal login forms with a password field and common one-time-code inputs; it
  does not see fields inside a page's own shadow DOM (open or closed), inside
  iframes, or split one-character OTP boxes.
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
