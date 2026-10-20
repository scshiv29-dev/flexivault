# Publishing the FlexiVault browser extension

The extension is a Chromium Manifest V3 package. It works in Chrome 116+, Edge
and Brave from the same zip. Firefox is **not supported yet** because the
manifest uses `background.service_worker` and the `chrome.*` APIs.

There are two separate things called “publishing”:

1. **GitHub Releases** — every tagged app release attaches a ready-to-upload
   `FlexiVault-Extension-<version>.zip` and its SHA-256 checksum.
2. **Browser stores** — a Chrome Web Store or Microsoft Edge Add-ons listing is
   created and reviewed by the store, not by this repository. The first
   submission is manual.

## 1. Build the upload zip

The release workflow creates the zip with only the runtime files. To build the
same package locally on Windows:

```powershell
New-Item -ItemType Directory -Force dist | Out-Null
Push-Location extension
Compress-Archive `
  -Path manifest.json, background.js, content.js, popup.html, popup.css, `
        popup.js, vault.html, src, fonts, icons `
  -DestinationPath ..\dist\FlexiVault-Extension-1.0.1.zip `
  -Force
Pop-Location

tar -tf dist\FlexiVault-Extension-1.0.1.zip | Select-Object -First 12
Get-FileHash dist\FlexiVault-Extension-1.0.1.zip -Algorithm SHA256
```

The zip must contain `manifest.json` at its **root**, not inside an
`extension/` folder. Entry order does not matter. Do not include `scripts/`,
`package.json`, test files or the repository. The store accepts the zip as-is;
it is not signed.

On Linux/macOS, use the same file list with `zip`:

```bash
cd extension
zip -r ../dist/FlexiVault-Extension-1.0.1.zip \
  manifest.json background.js content.js popup.html popup.css popup.js \
  vault.html src fonts icons
```

Before uploading, bump the version in **both** `extension/manifest.json` and
`extension/package.json`. The static check rejects a mismatch, and the stores
reject a version that is not greater than the currently published one.

## 2. Chrome Web Store

### One-time setup

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Register as a developer. Google charges a one-time registration fee (USD 5
   at the time of writing) and requires identity/email verification.
3. Enable 2-Step Verification on the Google account. Publisher accounts are
   expected to protect the account that can push extension updates.
4. Have a public privacy-policy URL ready. This repository includes a draft at
   [`docs/EXTENSION-PRIVACY.md`](../docs/EXTENSION-PRIVACY.md); host it on GitHub
   Pages, your website, or any public page. A raw GitHub file URL is public but
   a rendered page looks more trustworthy.

### Submit

1. In the dashboard choose **New item** and upload the zip.
2. Fill in **Store listing**:
   - **Name:** `FlexiVault`
   - **Summary:** `Self-hosted, end-to-end encrypted vault companion. Autofill, save or update logins and copy TOTP codes.`
   - **Category:** `Productivity`
   - **Language:** `English`
   - **Homepage URL:** `https://github.com/scshiv29-dev/flexivault`
   - **Support URL:** `https://github.com/scshiv29-dev/flexivault/issues`
   - **Privacy policy URL:** the public URL of the privacy policy
   - **Detailed description:** the copy below
3. Add the **128×128 icon** from `extension/icons/icon-128.png`.
4. Add **1–5 screenshots** at `1280×800` or `640×400` (PNG or JPEG). Useful
   shots:
   - the locked popup;
   - the unlocked vault list;
   - an inline login suggestion on a test form;
   - the full-page vault;
   - a live TOTP code.
   Optionally add a `440×280` small promotional image.
5. Open the **Privacy** tab and answer the questions as described below.
6. Set **Distribution** to public, all regions, free.
7. Add **Test instructions** with a working demo server and account. This is the
   part that most often blocks a self-hosted password manager.
8. Submit for review. Reviews commonly take several days and can take longer
   for broad host permissions and sensitive data. You can choose deferred
   publishing if you want to inspect the approved listing before it goes live.

### Detailed description copy

```text
FlexiVault is a browser companion for a self-hosted, end-to-end encrypted
password vault. Create and edit most items in the FlexiVault mobile app; the
extension unlocks the same vault in your browser so you can find a login, copy a
password or TOTP code, fill a form, and save or update a login after a form
submit without switching devices.

Features:
- Unlock the vault with your master password in a compact popup or a
  responsive full-page tab.
- Search logins, secure notes, payment cards, identities and authenticator
  items.
- Inline suggestions on matching login fields. The suggestion shows only the
  item name and username; the password is sent to the page only after you
  choose it.
- Save or update a login from a trusted form submit. The encrypted row is
  written locally first, then synced to your own server.
- Live TOTP codes on one-time-code fields, plus a code view with a countdown.
- Reveal or copy passwords, card data, identities and notes on demand.
- Host matching rejects look-alike domains, and the extension auto-locks after
  15 idle minutes.
- No analytics, telemetry, remote fonts or remote code.

Requirements:
- A FlexiVault server that you run or choose. This extension does not operate
  or provide a hosted server.
- A FlexiVault account created in the mobile app, plus the server URL, email
  and master password. Account creation and editing of cards, notes, identities
  and TOTP items stay in the app.

Security:
The master password never leaves the extension's trusted pages. PBKDF2-SHA256
derives an AES-256-GCM vault key locally; the server stores ciphertext and an
account verifier, not the password or vault key. The derived key is kept in
memory-backed session storage, and the content script receives a password only
after an explicit selection.

FlexiVault is open source under AGPL-3.0-only. Source and self-hosting
instructions: https://github.com/scshiv29-dev/flexivault
```

### Test instructions template

The extension cannot create an account and needs a reachable FlexiVault server.
Create a **separate demo account with dummy data**; never give reviewers your
personal vault or production account. Use a public HTTPS server and disable 2FA
for that account.

```text
FlexiVault is a client for a self-hosted, end-to-end encrypted password vault.
The reviewer account below contains dummy data only.

Server URL: https://demo.example.com
Email: chrome-review@example.com
Master password: <demo master password>
Account 2FA: disabled

Test steps:
1. Click the FlexiVault toolbar icon.
2. Enter the server URL, email and master password, then Unlock.
3. The vault lists a login for https://www.saucedemo.com/ and a TOTP item.
4. Open https://www.saucedemo.com/ in a tab, focus the username field, and
   choose the FlexiVault suggestion. The username and password fill only after
   the suggestion is selected.
5. Open the TOTP item in the popup and use Copy to verify clipboard access.

The demo vault contains no real credentials. The extension makes network
requests only to the server URL above, and only from the popup/full-page view or
the background worker's encrypted save/update sync. It does not contact any
other host.
```

Before submitting, test those exact steps from a clean Chrome profile with the
zip installed from the store-equivalent package. A reviewer who cannot log in
will reject the item as non-functional.

### Privacy practices answers

**Single purpose**

> FlexiVault is a client for a user's self-hosted, end-to-end encrypted password
> vault. It unlocks the vault, lists saved items, copies credentials or TOTP
> codes on request, fills saved login forms on matching websites, and can offer
> to save or update a login after a trusted form submit.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| `storage` | Stores the server URL, account email, encrypted vault cache, session token and derived-session key. The cache contains ciphertext only; the key is kept in memory-backed `chrome.storage.session`. |
| `activeTab` | Reads the active tab's URL for the user-initiated popup autofill and opens the content-script connection after the user clicks a suggestion. |
| `scripting` | Injects the packaged content script into a tab that was already open before the extension was installed or reloaded, only after the user clicks Autofill. |
| `clipboardWrite` | Copies a password, card number, note or TOTP code only after the user clicks Copy. |
| `http://*/*`, `https://*/*` | The content script must detect login and one-time-code fields on any site where the user has saved an item. It reads only the fields it may fill or a submitted login it can offer to save, shows suggestions in an isolated shadow root, and sends the field kind or captured credential to the background worker. The background worker makes network requests only to the configured FlexiVault server, for sync and encrypted save/update. |

**Remote code**

> No. All JavaScript is packaged in the extension. The extension does not load
> remote scripts, remote fonts, eval, or executable code from the server.

**Data use**

The extension processes the following data locally to provide its single
purpose. The developer does not receive it, and it is not sold or used for
advertising:

- **Authentication information** — the master password is processed locally;
  a derived authentication verifier is sent to the user's own server. Saved
  passwords and TOTP secrets are decrypted only after unlock.
- **Personally identifiable information** — the server URL and account email
  configured by the user, and identity details the user saved in the vault.
- **Financial and payment information** — saved card numbers and CVVs are
  decrypted only when the user opens or copies a card item. The developer does
  not receive them.
- **Website content** — the active hostname, the login/OTP field types used to
  match and fill a form, and the submitted username/password after a trusted form
  submit. The submitted pair is sent to the background worker to decide whether
  to offer a save/update prompt, then kept encrypted with the vault key in
  memory-backed session storage so it can survive a full-page navigation on the
  same site until the user saves, dismisses, or it expires. A password or code is
  sent to the page only after the user selects an item. A saved credential is
  encrypted with the vault key before it is written locally or sent to the
  user's own server.

The extension does not build a browsing history. It reads the active tab URL
only for a fill or to bind a save prompt to the current hostname, and does not
send it to the developer.

Answer **No** to selling data, transferring data for purposes unrelated to the
single purpose, and using data for creditworthiness or lending. Explain that
the only network destination is the server URL the user enters.

**Data retention**

> The user can choose Disconnect in the popup to remove the cached vault,
> session token, pending save prompts and server configuration. Uninstalling the
> extension removes its `chrome.storage` data. Data stored on the self-hosted
> server is controlled by the user.

## 3. Microsoft Edge Add-ons

The Edge Add-ons store accepts the same Chromium package.

1. Open the [Microsoft Edge Add-ons developer dashboard](https://partner.microsoft.com/dashboard/microsoftedge).
2. Register (free) with a Microsoft account and create a new extension.
3. Upload the same zip.
4. Reuse the Chrome listing text, screenshots and privacy answers. Edge may
   ask for a separate privacy-policy URL and review notes.
5. Submit. Review is typically shorter than Chrome’s but still requires a
   working test path.

Test the zip in Edge first (`edge://extensions` → Developer mode → Load
unpacked) before submitting; Edge follows Chromium MV3 but its store review
rules are separate.

## 4. Firefox status

Do not submit this package to AMO yet. Firefox does not support the current
`background.service_worker` + `chrome.*` combination without changes. A Firefox
port needs:

- a `browser.*` compatibility shim (or a build-time transform);
- a background event page or a verified service-worker path for the target
  Firefox version;
- a fresh `web-ext lint`/manual test pass.

That is a separate port, not a packaging step.

## 5. Publishing updates

1. Change the extension; bump `extension/manifest.json` **and**
   `extension/package.json` to the same higher version.
2. Run `cd extension && npm run check && npm test`.
3. Build the zip as above. For an app release, a `v*` tag also attaches the zip
   to the GitHub Release automatically.
4. Upload the zip to the store dashboard. Chrome Web Store requires a higher
   version than the published one; the store keeps the previous version until
   the new one is approved.
5. If the extension changed without an app release, build the zip locally and
   upload it directly. The extension version is independent of the APK version.

The stores do not support an unattended first publish from this repository.
After the first listing exists, Chrome Web Store API automation is possible with
an OAuth client and refresh token, but it still requires your developer account
and review. Keep the manual dashboard path as the fallback.

## Checklist

- [ ] `manifest.json` and `package.json` versions match and are higher than the
      published version.
- [ ] `npm run check && npm test` passes from `extension/`.
- [ ] Zip root contains `manifest.json`; no `scripts/`, tests or nested
      `extension/` folder.
- [ ] 128×128 icon and at least one 1280×800/640×400 screenshot.
- [ ] Public privacy-policy URL.
- [ ] Reviewer demo server, account, dummy vault and test steps.
- [ ] Permission justifications and data-use answers are filled in.
- [ ] Chrome and Edge packages tested from a clean profile.
