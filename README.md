# FlexiVault

A self-hosted, end-to-end encrypted password manager: an Expo mobile app, a
zero-dependency sync server, and a Manifest V3 browser extension. FlexiVault
started life as a TOTP authenticator; it now stores logins, secure notes,
cards, identities and authenticator codes in one vault, with the old
authenticators migrated automatically.

- **Mobile** — the writer. Create, edit, organize, audit and back up the vault.
- **Server** — optional sync. Stores only opaque ciphertext, never keys.
- **Extension** — the reader. Unlock, copy, generate TOTP and autofill.

The mobile app works entirely offline. A server only adds multi-device sync.

## Layout

```
.
├── app/                  Expo Router screens (auth, tabs, item editor)
├── components/           UI primitives, vault rows, tab bar
├── lib/
│   ├── crypto/           Local HOTP/TOTP primitives
│   ├── state/            Vault provider, clock, helpers
│   ├── store/            SQLite persistence and secure session storage
│   └── vault/            Crypto, API, sync, OTP, otpauth, generator, security
├── server/               Node 22 sync server (no npm dependencies)
├── extension/            MV3 popup, full vault page, background suggester
├── docs/                 publishing, Coolify, import, autofill guides
├── docker-compose.yml    One-command server deployment
├── docker-compose.coolify.yml  Coolify deployment (internal port)
└── .env.example          Compose configuration
```

## Features

### Mobile app

- Five item types: login, secure note, payment card, identity, authenticator.
- TOTP with live progress rings, QR scanning, `otpauth://` paste/import, manual
  secrets, and automatic migration of the legacy `flexiauth` authenticator DB.
- Password and passphrase generator, entropy estimate and strength meter.
- CSV and Bitwarden JSON import from common password managers, with a preview,
  folder preservation and invalid-TOTP warnings.
- Groups (encrypted folders): filter from the vault, rename/delete without
  deleting items, and assign from the item editor.
- Security report: weak, reused, missing-2FA and stale passwords.
- Folders, favorites, search and type filters.
- Biometric unlock (Face ID / fingerprint) with the derived key in the device
  keychain, background auto-lock (5/15/30 minutes or never), and lock-now.
- Encrypted backup export (ciphertext + KDF parameters) and device reset.
- Optional self-hosted sync with revision conflict detection.
- Optional server-side TOTP as a second factor for sign-in.

### Browser extension

- Read-only vault browser with search and filters, as a compact popup or a
  dedicated responsive full-page tab.
- Inline suggestions on matching login fields. Choosing one fills the form
  without opening the toolbar popup.
- Inline live TOTP suggestions on `autocomplete="one-time-code"` and other
  recognisable code fields.
- Reveal/copy passwords, card data, identities and notes.
- Live TOTP codes and copy.
- Autofill of username/password, refused when the active hostname does not
  match the saved site. Inline suggestions use the saved hostname or one of its
  subdomains, never a look-alike.
- 15-minute idle auto-lock; the session token survives a lock for silent
  re-authentication. Disconnect clears everything.
- No remote code, no analytics, no build step.

### Server

- Node 22 `node:http`, `node:sqlite`, `node:crypto` only. No `npm install`.
- Email + `authHash` accounts, scrypt verifier, HS256 bearer tokens.
- Revision-based full-vault snapshots with `409 revision_mismatch` conflict
  responses and client-side merge.
- Optional TOTP setup/enable/disable for sign-in.
- Per-IP/per-account rate limits, request caps, CORS allowlist.
- Dockerfile and Compose file with a persistent volume and health check.
- Coolify-ready Compose file that uses the internal proxy instead of a public
  host port.

## How the encryption works

```
master password
      │
      │ PBKDF2-SHA256, 210,000 rounds, per-account salt
      ▼
 64 bytes
      ├──────── 32 bytes ──► AES-256-GCM vault key (never leaves the device)
      └──────── 32 bytes ──► SHA-256(… + "flexivault:auth:v1") = authHash
                                              │
                                              │ TLS
                                              ▼
                                   scrypt(authHash, authSalt) = verifier
```

Every vault item is encrypted independently:

```
v1.<base64 12-byte IV>.<base64 ciphertext + 16-byte GCM tag>
```

The server stores item IDs, envelopes, timestamps and a revision. It never
stores plaintext, the vault key, the master password, or the raw `authHash`;
only an scrypt verifier is persisted.

The extension derives the same keys in WebCrypto. It caches envelopes in
`chrome.storage.local`, keeps the derived key only in memory-backed
`chrome.storage.session`, and verifies the password offline against a stored
`keyCheck`.

### Sync

`GET /api/sync` returns `{ revision, items }`. `PUT /api/sync` replaces the
snapshot with `{ baseRevision, items }`:

1. The client pulls first and merges by item `updatedAt`, keeping deletion
   tombstones.
2. If the server revision moved, it returns `409 revision_mismatch` with the
   current snapshot. The client merges and retries (up to 4 times).
3. `force: true` is reserved for the explicit "replace this device" flow.
4. The extension only pulls; the mobile app is the single writer.

## Getting started

### Prerequisites

- Node.js **22.5+** for the server (the app's Expo toolchain is happy on 20+).
- Android Studio / Xcode. The app targets **Expo SDK 57**, which is currently
  supported by Expo Go. Use Expo Go for a quick launch, or a native development
  build for native verification and standalone testing.
- Optional: Docker for the server.

### Mobile app

```bash
npm install
npx expo start --go    # open the project in Expo Go
# or
npm run android        # build and install the native development app
```

`npm run android` starts Metro after installing the debug build. Rebuild after
changing native dependencies; JavaScript-only changes hot-reload normally.
Expo Go 57 is enough for everyday development; the native build is still the
right target for 16 KB page-size and standalone checks.

On first launch:

1. **Create a new vault** with a master password (minimum 10 characters).
   There is no recovery; the password is the only way to decrypt the vault.
2. If the legacy 2FA database is present, its entries are imported into the new
   encrypted vault.
3. To sync, open **Settings → Server**, enter your server URL, email and master
   password. If that email has no account yet, the app registers it and uploads
   the encrypted vault. On a second device, use **Connect** on the welcome
   screen instead.

The local database is `flexivault.db` (SQLite). The app slug/package remain
`flexiauth` for compatibility with existing builds.

### Android 16 KB page-size compatibility

There are two different APKs involved, and they need different fixes.

**Expo Go's warning.** If the warning appears while launching Expo Go, Android
is complaining about Expo Go's own client APK, not FlexiVault. A report from
Expo Go can name `libcrashlytics*.so`, `libavif_android.so`,
`libface_detector_v2_jni.so`, `libexpo-gl.so`, and `libexpo-av.so`. None of
those are dependencies of this project; they are native modules inside Expo Go.
No project setting can re-align Expo Go's prebuilt libraries. Use a
development/standalone build to test FlexiVault itself.

**FlexiVault standalone builds.** The old SDK 51 / React Native 0.74 build was
not 16 KB-compatible: React Native 0.74 ships many separate 4 KB-aligned
libraries, and `expo-sqlite` 14 ships `libcrsqlite.so` with `LOAD` alignment
`0x1000`. Packaging flags cannot change the alignment of a prebuilt `.so`
file. The mobile app is now on **Expo SDK 57 / React Native 0.86.3** with the
**New Architecture** enabled (mandatory since SDK 55). Its prebuilt React
Native and Expo libraries use `p_align=0x4000`, and `expo-sqlite` 57 builds
SQLite from source with `-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON`.
`expo.useLegacyPackaging=false` keeps the libraries uncompressed. The generated
`android/gradle.properties` sets `newArchEnabled=true` and
`edgeToEdgeEnabled=true`; do not disable the New Architecture on SDK 57.
Build and verify:

```bash
npx expo prebuild --platform android --clean
cd android
./gradlew :app:assembleRelease
```

```powershell
$apk = "app/build/outputs/apk/release/app-release.apk"
$zipalign = Get-ChildItem "$env:ANDROID_HOME\build-tools" -Recurse -Filter zipalign.exe |
  Sort-Object FullName | Select-Object -Last 1 -ExpandProperty FullName
& $zipalign -c -P 16 -v 4 $apk

# Extract the APK (it is a zip) and inspect every 64-bit library.
Copy-Item $apk apk-check.zip
Expand-Archive apk-check.zip -DestinationPath apk-check -Force
$readelf = Get-ChildItem "$env:ANDROID_HOME\ndk" -Recurse -Filter llvm-readelf.exe |
  Select-Object -First 1 -ExpandProperty FullName
Get-ChildItem apk-check\lib\arm64-v8a,apk-check\lib\x86_64 -Filter *.so |
  ForEach-Object {
    $aligns = & $readelf -l $_.FullName |
      Select-String "^\s*LOAD" |
      ForEach-Object { if ($_.Line -match "(0x[0-9a-fA-F]+)\s*$") { $matches[1] } } |
      Sort-Object -Unique
    "{0,-40} {1}" -f $_.Name, ($aligns -join ",")
  }
# Every printed value must be 0x4000 (or larger), never 0x1000.
```

A local SDK 57 debug build of this checkout passed both checks and launched on
a 16 KB page-size Android 17 emulator. The 64-bit libraries include
`libreactnative.so`, `libhermesvm.so`, `libappmodules.so`,
`libexpo-modules-core.so`, `libexpo-sqlite.so`,
`libreact_codegen_rnscreens.so`, `libbarhopper_v3.so` and `libreanimated.so`;
none of the old `libcrsqlite.so`, `libcrashlytics*.so`, `libavif_android.so` or
`libface_detector_v2_jni.so` libraries are present.

32-bit ABIs can remain 4 KB-aligned; Android's 16 KB devices load the 64-bit
`arm64-v8a` or `x86_64` libraries. For Play, upload the AAB and check the
`arm64-v8a` libraries. SDK 57 is currently the Expo Go target; Expo Go 57.0.9
launched this checkout on the 16 KB emulator. Use `npx expo start --go` for
Expo Go, or `npm run android` (or an EAS preview/production build) for a native
standalone build.

### Server

Docker (recommended):

```bash
cp .env.example .env
docker compose up -d --build
curl http://localhost:8787/api/health
```

Or directly:

```bash
cd server
npm start                # http://localhost:8787, data in server/data
```

Put TLS in front before exposing the port. See [`server/README.md`](server/README.md)
for environment variables, reverse-proxy examples, backups and the API.

For a managed deployment with automatic HTTPS, see
[`docs/COOLIFY.md`](docs/COOLIFY.md). It uses
[`docker-compose.coolify.yml`](docker-compose.coolify.yml) and explains the
persistent volume, environment variables and backups.

### Browser extension

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select `extension/`.
3. Connect with the same server URL, email and master password. Create the
   server account in the mobile app first if it does not exist.

See [`extension/README.md`](extension/README.md) for the permission model and
security notes.

## Tests and checks

```bash
# Mobile: unit tests, types and production bundle
npm test
npx tsc --noEmit
npx expo export --platform android

# Server: end-to-end HTTP tests on an ephemeral port
cd server && npm test

# Extension: static checks + content/background + popup E2E (real server)
cd extension && npm run check && npm test
```

The mobile suite covers RFC 4226/6238 vectors, base32 and legacy-secret
conversion. The extension tests cover the autofill content script, background
host matching and password-free suggestions, connect, PBKDF2/AES compatibility,
vault decryption, the full-page vault, search/filters, TOTP, copy, autofill,
sync, lock, wrong-password rejection, session restore, stale-session lock and
disconnect.

### Manual full-stack test

One command starts an isolated server, a seeded encrypted vault, Expo and the
extension in Chrome:

```bash
npm run test:everything
```

The launcher picks the first free server port from 8787 (so it can coexist with
Docker Compose), seeds the demo account below, starts Expo, opens Chrome with
the unpacked extension on a full vault page, and serves a local login + 2FA page
for autofill:

```text
Email:             demo@flexivault.test
Master password:   flexivault-demo-2026
Demo login pass:   demo-login-password-42!
```

The demo vault contains a login with live TOTP, a secure note, a test card and
an identity. On mobile choose **Sign in to a server** and enter the phone URL
printed by the launcher. In the browser, connect the full vault page, open the
demo login, focus the email field and choose the inline FlexiVault suggestion;
after submitting, choose the live TOTP suggestion on the code field. The local
demo server verifies both the password and a current TOTP code (one step of
clock skew). Test data lives in `.manual-test/` (gitignored) and never touches
`server/data/`.

```bash
node scripts/test-everything.mjs --check       # start, verify, then shut down
node scripts/test-everything.mjs --fresh       # wipe test data and browser profile
node scripts/test-everything.mjs --no-browser  # server + Expo only
node scripts/test-everything.mjs --no-expo     # server + extension only
```

`npm run test:everything` is the same as the no-argument run. Pass options
directly to `node`; some npm versions consume flags such as `--check` before
they reach the script.

SDK 57 is the current Expo Go target, so `npx expo start --go` works with the
seeded demo. If Expo Go reports an unsupported SDK, run `npm run android`, or
use an EAS preview build; the seeded account and server URL work the same way.

## Threat model

**Protected against**

- A compromised or curious sync server: it only sees ciphertext, account email,
  KDF parameters, item IDs, sizes, and timestamps.
- Theft of the server database or backups without the master password.
- Offline brute force of the server verifier beyond scrypt cost; the vault key
  additionally requires PBKDF2 over the master password.
- Silent use of a stolen extension session after 15 idle minutes: the key is
  dropped, though the token remains for re-authentication.
- Autofill on a look-alike domain: host matching blocks unrelated hosts.

**Not protected against**

- A weak or reused master password. Use a long, unique passphrase.
- A compromised phone, browser profile, OS keychain, or malicious extension
  with access to the same storage.
- Phishing that convinces you to type the master password into a fake app.
- Traffic analysis and metadata leakage (account email, item count/sizes).
- Loss of the master password. There is no reset or recovery key.
- A malicious server serving manipulated ciphertext (GCM detects tampering, but
  rollback/replay of old snapshots is not prevented).

## Known limitations

- No system-wide mobile autofill yet. The app is not registered with Android's
  `AutofillService` or iOS's credential provider, so it cannot fill fields in
  other apps. See [`docs/AUTOFILL.md`](docs/AUTOFILL.md) for the native plan.
- No sharing, organizations, collections, passkeys, or file attachments.
- Single-node server only; in-memory rate limits do not span replicas.
- No account deletion or password-change endpoint; manage the data directory
  manually. Rotating the master password would require re-encrypting the vault.
- The extension cannot create or edit items and never writes to `/api/sync`.
- Inline suggestions require an unlocked vault and a login form with a password
  field. Fields inside a page's own shadow DOM, iframes, split one-character OTP
  boxes, and card/identity/CVC fields are not suggested.
- Card/identity autofill is not implemented; only login credentials are filled.
- The UI is portrait-first and the extension is Chromium-only (MV3, Chrome 116+).
- Import copies items; it does not deduplicate repeated imports or connect to
  another password manager's API.
- No Play Store listing. GitHub Releases hosts personal APKs; public F-Droid
  inclusion is currently blocked by the proprietary ML Kit dependency pulled in
  by `expo-camera` barcode scanning. See
  [`docs/PUBLISHING.md`](docs/PUBLISHING.md).
- This is a learning-focused project, not an audited password manager.

## Documentation

- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — personal signed APKs, GitHub
  Releases, F-Droid metadata and the ML Kit blocker.
- [`docs/COOLIFY.md`](docs/COOLIFY.md) — deploy the sync server on Coolify with
  Docker Compose, HTTPS, a persistent volume and backups.
- [`docs/IMPORTING.md`](docs/IMPORTING.md) — supported CSV/JSON formats, field
  mapping, groups and safety notes.
- [`docs/AUTOFILL.md`](docs/AUTOFILL.md) — Android/iOS system autofill
  architecture, security requirements and phasing.
- [`server/README.md`](server/README.md) — deployment, configuration, API,
  backup, security notes.
- [`extension/README.md`](extension/README.md) — install, permissions, layout,
  threat model, limitations.
