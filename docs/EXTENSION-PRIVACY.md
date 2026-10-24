# FlexiVault browser extension privacy policy

Last updated: 2026-10-20

FlexiVault is a self-hosted password manager. The browser extension is a client
for a FlexiVault server that you run or choose. The FlexiVault project does not
operate a hosted service and does not receive your vault data.

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
- **Session data.** The bearer token and derived vault key are kept in
  memory-backed `chrome.storage.session`. Locking drops the key but retains the
  token for silent re-authentication; closing the browser clears both.
- **Master password.** The master password is entered only in trusted extension
  pages: the popup, full-page view, or the browser-owned unlock window opened by
  a locked form. It is processed locally with PBKDF2-SHA256 and never exposed to
  the website. Popup/full-page sign-in sends a derived authentication verifier
  to your server; form unlock validates the local key check and encrypted cache
  without sending an authentication request.
- **Web page data.** The content script reads the active hostname and the login
  or one-time-code field types needed to match a saved item and fill a form.
  Passwords and TOTP codes are returned to the page only after you explicitly
  choose an item. The content script does not receive secrets while suggestions
  are being listed. While locked, it receives no vault item names, usernames or
  IDs—only that a configured vault is locked. After a trusted form submit, it sends the submitted username
  and password to the background worker only to decide whether to offer a
  save/update prompt. The pending pair is encrypted with the vault key and kept
  in memory-backed `chrome.storage.session` for up to five minutes so the prompt
  can survive a full-page navigation on the same site. It is written to the
  local cache and synced to your own server as ciphertext only after you choose
  Save. Dismissing the prompt, saving it, or letting it expire removes the
  pending record. The pending password is never sent back to the page.
- **Clipboard.** A password, card number, note or TOTP code is copied only after
  you click Copy.

## What the extension does not do

- It does not send analytics, telemetry, crash reports or advertising data.
- It does not sell or rent data.
- It does not load remote code, remote fonts or `eval`; all JavaScript is
  packaged with the extension.
- It does not contact a developer-operated server. Network requests go only to
  the FlexiVault server URL you configure, from the popup/full-page view or the
  background worker's encrypted save/update sync.
- It does not create accounts. Account creation, editing of cards/notes/identities,
  recovery and 2FA setup happen in the mobile app. The extension can save or
  update login credentials after a form submit.

## Storage and deletion

- Cached items, the server URL, the email and the bearer token remain in
  `chrome.storage.local` until you choose **Disconnect** in the extension or
  uninstall it.
- The derived key lives in `chrome.storage.session` and is cleared when the
  browser exits or the vault locks.
- Pending save/update prompts are encrypted with the vault key in
  `chrome.storage.session`. They are removed when you save or dismiss them, and
  are treated as expired and removed on the next access after five minutes. They
  are never written to `chrome.storage.local` in plaintext.
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
