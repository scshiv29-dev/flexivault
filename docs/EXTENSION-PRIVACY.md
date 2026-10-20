# FlexiVault browser extension privacy policy

Last updated: 2026-10-20

FlexiVault is a self-hosted password manager. The browser extension is a
read-only client for a FlexiVault server that you run or choose. The FlexiVault
project does not operate a hosted service and does not receive your vault data.

This policy describes the browser extension. The mobile app and the server are
covered by the same project and the same principles.

## Data the extension handles

- **Server connection.** The server URL and account email you enter are stored
  in `chrome.storage.local` so the extension can reconnect.
- **Encrypted vault cache.** Vault items downloaded from your server are stored
  locally as ciphertext envelopes. The extension does not store plaintext items
  in extension storage.
- **Vault item contents.** Items can include logins, secure notes, payment
  cards, identities and authenticator codes. They are decrypted locally only
  when you open, reveal or copy an item.
- **Session data.** A bearer token is stored in `chrome.storage.local`; the
  derived vault key is kept in memory-backed `chrome.storage.session`. Locking
  drops the key. The token allows a silent re-authentication after the idle
  timeout.
- **Master password.** The master password is entered in the popup or full-page
  view and processed locally with PBKDF2-SHA256. It is never sent to the server.
  A derived authentication verifier is sent to your server to sign in.
- **Web page data.** The content script reads the active hostname and the login
  or one-time-code field types needed to match a saved item and fill a form.
  Passwords and TOTP codes are returned to the page only after you explicitly
  choose an item. The content script does not receive secrets while suggestions
  are being listed.
- **Clipboard.** A password, card number, note or TOTP code is copied only after
  you click Copy.

## What the extension does not do

- It does not send analytics, telemetry, crash reports or advertising data.
- It does not sell or rent data.
- It does not load remote code, remote fonts or `eval`; all JavaScript is
  packaged with the extension.
- It does not contact a developer-operated server. Network requests go only to
  the FlexiVault server URL you configure, and only from the popup/full-page
  view. The background worker makes no network requests.
- It does not create accounts. Account creation, item editing, recovery and 2FA
  setup happen in the mobile app.

## Storage and deletion

- Cached items, the server URL, the email and the bearer token remain in
  `chrome.storage.local` until you choose **Disconnect** in the extension or
  uninstall it.
- The derived key lives in `chrome.storage.session` and is cleared when the
  browser exits or the vault locks.
- Data stored on your self-hosted server is controlled by you and your server
  operator. The project does not have access to it.
- Uninstalling the extension removes its local extension storage. It does not
  delete data from your server or mobile app.

## Security

Vault items are encrypted end to end with AES-256-GCM. The server stores
ciphertext and an account verifier, not the master password or vault key. Use
HTTPS for any server reachable from the internet; the extension permits HTTP
for a local-network server. As with any password manager, a compromised browser
profile, a malicious extension with storage access, or a weak master password is
outside the extension's protection.

## Contact

Questions or deletion requests for data controlled by this project can be sent
through the repository issue tracker:

https://github.com/scshiv29-dev/flexivault/issues

Data on a self-hosted server is controlled by that server's operator.
