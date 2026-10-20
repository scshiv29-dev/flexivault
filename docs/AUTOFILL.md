# System autofill and passkeys on mobile

Status: **Android implemented; device verification pending.** The Android app
registers a native `AutofillService` and an Android 14+ `CredentialProviderService`,
keeps login-only encrypted caches and requires a biometric or device-credential
check for every fill and every passkey assertion. Save/update prompts are
implemented. iOS autofill and iOS passkeys are not implemented.

Expo Go cannot exercise this feature. It needs a native APK built from
`android/` (for example `npx expo run:android` or a Gradle build).

## What works

- FlexiVault appears in **Settings → System → Languages & input → Autofill**
  (the exact menu varies by OEM) as an autofill service.
- Browser forms are matched by the page's `webDomain`: an exact saved hostname
  or a subdomain of it. A look-alike such as `example.com.evil.test` does not
  match `example.com`. Browser pages never fall back to matching the browser's
  own package name, even when a page does not expose a web domain.
- Native Android forms are matched first by an explicit package name saved on
  the login, then by tokens from the app label and package name against the
  login name and saved hostnames. A login called "Reddit" can therefore fill the
  Reddit app without a manual package entry.
- The item editor has an optional **Android app package** field for logins. It
  tightens matching when the app label is ambiguous. Multiple packages can be
  separated by commas.
- Each dataset asks for biometrics or the device PIN/pattern/password before
  Android fills the username and password. The prompt is a translucent activity
  over the app being filled; FlexiVault's own task is not brought forward, and no
  "draw over other apps" permission is required. Cancelling fills nothing.
- The cache is login-only. It contains no notes, cards, identities, TOTP seeds,
  settings or vault keys.
- The cache survives app locks and device reboots. It is cleared when autofill is
  disabled, the vault is reset, the cache is corrupted, or after 30 days.
- Settings shows whether the service is selected and opens the Android autofill
  settings screen.
- Login submissions can show a translucent **Save login** / **Update login**
  prompt over the app being filled. Saving or updating never opens FlexiVault.
  If the vault is locked, the credential is queued in a Keystore-encrypted store
  and imported on the next unlock or foreground.
- On Android 14 (API 34) and newer, FlexiVault can also act as a passkey
  provider. It can create and assert synced P-256 passkeys in supported apps and
  privileged browsers, gated by the same biometric or device-credential check.
  Passkeys are stored as encrypted vault items and mirrored into a
  Keystore-encrypted native store so the provider works while the app is locked.
- Settings shows a passkey setup row on Android 14+ and opens Android's
  credential-provider settings screen.

Chrome may also show its built-in password manager. Modern Chrome builds only
route web forms to third-party autofill services after you opt in: **Chrome →
Settings → Autofill and passwords → Autofill services → Autofill using another
service**, then restart Chrome. FlexiVault datasets then appear through Android's
autofill UI. Other browsers use Android's picker directly.

If Chrome still hides third-party suggestions, disable Chrome's built-in password
manager or use Android's autofill picker.

Current limitations:

- Only login items are offered for autofill. Cards and identities can be stored
  in the vault but are not filled.
- Save/update prompts capture a submitted username/password pair. They queue it
  in a Keystore-encrypted store; after the vault is unlocked, the app merges it
  into the matching item, marks it dirty, and syncs. They cannot detect every
  custom web component or native form.
- Passkeys require Android 14 (API 34) or newer and the user selecting FlexiVault
  as a credential provider. OEM builds may hide or omit third-party provider
  support.
- Browser passkeys rely on the browser being on Google's privileged-app
  allowlist so FlexiVault can resolve the website origin. Chrome and Edge are the
  supported targets; Firefox is not supported.
- Passkeys are software keys with `fmt: "none"` attestation and backup-eligible
  flags. Relying parties that require hardware attestation or a non-zero
  signature counter will reject them.
- Only the first detected username/password pair in a form is filled. On an
  email-first sign-in page, a dataset can fill the username even though no
  password field is present yet; the password step needs a second fill.
- The autofill service needs Android 8.0 (API 26) or newer. Passkeys need API 34.
- A native build is required; these features are unavailable in Expo Go.
- iOS needs a separate AutoFill Credential Provider extension and Apple signing.
  iOS passkeys are out of scope for this implementation.

## Architecture

```text
React Native app (unlocked)
  │  lib/native/autofill.ts
  ▼
FlexiVaultAutofillModule (native module)
  │  login-only JSON
  ▼
AutofillCache ── AES-256-GCM ── Android Keystore key
  │  SharedPreferences ciphertext (not a plaintext file)
  ▲
  │
FlexiVaultAutofillService
  │  parses AssistStructure, matches host/package/tokens
  │  builds Dataset + mutable non-exported PendingIntent
  ▼
AutofillAuthActivity ── BiometricPrompt / Keyguard
  │  RESULT_OK + EXTRA_AUTHENTICATION_RESULT (populated Dataset)
  ▼
Android fills the target fields
```

Save/update adds a second, optional path:

```text
FlexiVaultAutofillService
  │  SaveInfo + onSaveRequest
  ▼
AutofillSaveActivity (translucent over the target app)
  │  Save / Update / Not now
  ▼
AutofillPendingStore ── AES-256-GCM ── Android Keystore key
  │  stable item id + encrypted pending credential
  ▼
JS import on unlock/foreground
  │  merge into the encrypted vault, mark dirty, sync
  ▼
Pending rows are also overlaid on the autofill cache
```

Android 14+ passkeys use a separate provider surface:

```text
Browser / native app
  │  Credential Manager
  ▼
FlexiVaultCredentialProviderService
  │  create entry or matching passkey entries
  ▼
PasskeyActivity ── BiometricPrompt / Keyguard
  │  ES256 signature or fmt:"none" attestation
  ▼
PasskeyStore (Keystore AES-GCM mirror) + VaultItem.passkey
```

### Cache lifecycle

JS rebuilds the cache after unlock, item changes, imports, group operations and
when the setting is enabled. Bulk changes are debounced by 300 ms.

The cache is written with `SharedPreferences.commit()` after AES-GCM encryption.
The key is generated in `AndroidKeyStore` under the alias
`flexivault.autofill.v1` and is not exportable. The payload is stored as
`base64(iv):base64(ciphertext)`.

The cache also stores the wall-clock time at write time. On read:

- if the stored time is in the future by more than a 10-minute clock-skew
  allowance, the cache is deleted;
- if it is older than 30 days, the cache is deleted;
- if decryption or JSON validation fails, the cache is deleted;
- an empty login list deletes the cache.

The cache is **not** cleared by `lock()`, app restart, backgrounding, or a device
reboot. Each fill is still gated by the authentication activity, so the cache
cannot be used without a biometric or device-credential prompt. `resetVault()`
and disabling autofill call `clearAutofillCache()`. The service never writes to
the vault.

### Why each fill is authenticated

A malicious app can draw a fake login form and ask Android for autofill. Returning
credentials without user action would hand them to that app. Every dataset is
therefore attached to an authentication `PendingIntent`. The activity is not
exported, is excluded from recents, sets `FLAG_SECURE`, and returns `RESULT_OK`
only after:

- `BiometricPrompt` with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` on Android 11
  (API 30) and newer when biometric hardware is enrolled;
- `KeyguardManager.createConfirmDeviceCredentialIntent` when only a PIN, pattern
  or password is available, and on Android 8–10.

If the device has no secure lock screen, the service offers no datasets.

The authentication `PendingIntent` is deliberately mutable on Android 12+ so
the platform can add its autofill arguments. The activity is launched without
`FLAG_ACTIVITY_NEW_TASK`, so it stays in the caller's task and appears over the
target form; finishing returns to that app. It returns a fully populated
`Dataset` in `AutofillManager.EXTRA_AUTHENTICATION_RESULT`. Returning only
`RESULT_OK` dismisses the authentication prompt without filling anything.

After authentication, the activity rechecks that the login is still present in
the unexpired cache. If the vault was reset, autofill was disabled, or the cache
expired while the prompt was open, the fill is cancelled instead of completing a
stale dataset.

The cache key is deliberately not auth-bound to a `CryptoObject`. Doing that
would require passing a `CryptoObject` from the service to the activity, and the
dataset values are built by the service before the prompt. The authentication
gate above is the security boundary; the cache is encrypted at rest and every
fill requires a device authentication prompt.

### Save and update prompts

The service attaches `SaveInfo` when it detects a login form it can capture. On
commit, `onSaveRequest()` reads the submitted username/password pair, works out
whether an existing login matches the package or web host and username, and
launches `AutofillSaveActivity` as a translucent overlay.

The overlay:

- uses an empty task affinity, `excludeFromRecents` and `noHistory`, so it does
  not pull FlexiVault's main task forward;
- sets `FLAG_SECURE`, so the captured credential is not screenshotted;
- offers **Save** for a new login, **Update** for an existing one, and **Not
  now**;
- hands an accepted credential to a running JS session through a short-lived
  in-process handoff, and writes the durable copy to
  `AutofillPendingStore` in every case.

`AutofillPendingStore` is encrypted with AES-256-GCM under the same Android
Keystore pattern as the autofill cache, with alias `flexivault.autofill.pending.v1`.
It is the source of truth for the next import. Pending rows are overlaid on the
autofill cache so a just-saved login can be offered for a subsequent fill before
the React Native app next imports it.

On unlock and foreground, the JS provider imports the queue. Stable item IDs
make retries idempotent. An update replaces only the credential fields; notes,
folder, favorite flag and TOTP seed are preserved. The vault row is marked dirty
and scheduled for encrypted sync, then the queue entry is cleared. A failed
import leaves the queue intact for the next attempt.

### Android passkeys

The passkey provider requires Android 14 (API 34) and
`androidx.credentials:credentials:1.6.0`. The manifest declares
`FlexiVaultCredentialProviderService` with
`android.permission.BIND_CREDENTIAL_PROVIDER_SERVICE`,
`res/xml/credential_provider.xml`, and the
`androidx.credentials.TYPE_PUBLIC_KEY_CREDENTIAL` capability. The service and
activity are disabled below API 34 through a `values-v34` boolean.

Creation:

1. `onBeginCreateCredentialRequest()` validates the WebAuthn creation options,
   accepts only ES256 (`alg: -7`), honors `excludeCredentials`, and returns one
   `CreateEntry`.
2. `PasskeyActivity` generates a fresh P-256 key pair and a 32-byte credential ID.
3. It writes the credential to `PasskeyStore` with `pending = true`.
4. It returns `fmt: "none"` attestation with an empty `attStmt`.

Assertion:

1. `onBeginGetCredentialRequest()` parses each request's `rpId` and
   `allowCredentials`, reads the native store, and returns a
   `PublicKeyCredentialEntry` for each matching credential.
2. The selected entry launches `PasskeyActivity`, which rechecks that the
   credential still belongs to the requested RP and is allowed by the request.
3. After device authentication it signs
   `authenticatorData || clientDataHash` for browser calls, or
   `authenticatorData || SHA256(clientDataJSON)` for native calls.
4. It returns the DER-encoded ES256 signature and the stored user handle.

Both flows use these WebAuthn details:

- `rpIdHash = SHA256(rpId)`;
- registration flags `0x5D` (`UP | UV | BE | BS | AT`), assertion flags `0x1D`
  (`UP | UV | BE | BS`);
- a four-byte zero signature counter, because the credential is synced and
  backup-eligible;
- a COSE ES256 key with integer labels (`1: 2`, `3: -7`, `-1: 1`, `-2: x`,
  `-3: y`);
- unpadded base64url for every WebAuthn identifier and signature;
- `clientExtensionResults: {}`.

Every create and every assertion is gated by `PasskeyActivity`. It uses
`BiometricPrompt` with `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` when available and
falls back to `KeyguardManager.createConfirmDeviceCredentialIntent`. It sets
`FLAG_SECURE`, uses an empty task affinity, and returns Credential Manager
cancellation or unknown exceptions instead of a half-built response. Listing
entries while the vault is locked is allowed; signing is not.

### Passkey storage and sync

A passkey is stored on the normal login row:

```ts
interface PasskeyRecord {
  credentialId: string; // base64url
  rpId: string;
  userHandle: string; // base64url
  userName: string;
  displayName: string;
  privateKey: string; // base64url P-256 scalar
  publicKeyX: string;
  publicKeyY: string;
  createdAt: number;
  lastUsedAt?: number;
  signCount?: number;
}
```

`VaultItem.passkey` is encrypted with the rest of the item by the vault master
key, so it syncs end-to-end encrypted and is included in encrypted backups. The
native `PasskeyStore` is a Keystore-encrypted mirror at
`flexivault.passkey.v1`, stored in `SharedPreferences` as
`base64(iv):base64(ciphertext)`.

On unlock and foreground:

1. `readPendingPasskeys()` imports native pending creates into the vault.
2. The vault row is marked dirty and scheduled for sync.
3. `clearPendingPasskeys()` clears the native pending flag.
4. `syncNativePasskeys()` mirrors all live vault passkeys into the native store.

The mirror uses vault tombstones: `deletedVaultItemIds` removes a passkey that
was deleted on another device. `resetVault()` clears the native store. An empty
local cache before the first server pull does not delete native entries; only a
tombstone does. This matters because the provider must remain usable while the
React Native app is locked or has not finished its first sync.

The native store key is not bound to a `CryptoObject`; the provider must read
entries before it can show the device-auth prompt. As with autofill, the device
authentication in `PasskeyActivity` is the signing boundary, and the private
scalar is encrypted at rest in both the vault and the native store.

### Browser origins and the privileged-app allowlist

For browser calls, Credential Manager supplies a `clientDataHash` and, for
privileged browsers, resolves the website origin through
`CallingAppInfo.getOrigin()`. FlexiVault bundles Google's privileged-app
allowlist snapshot at
`android/app/src/main/assets/passkey_privileged_apps.json`, sourced from
`https://www.gstatic.com/gpm-passkeys-privileged-apps/apps.json`.

When `clientDataHash` is present, FlexiVault signs that hash and returns an empty
`clientDataJSON` placeholder. Credential Manager fills in the browser's original
client data. This avoids reconstructing browser-specific client data and is the
contract documented by AndroidX.

For native app calls there is no `clientDataHash`. FlexiVault builds
`clientDataJSON` itself and uses
`android:apk-key-hash:<base64url(SHA256(signing certificate))>` as the origin.

Chrome and Edge are the supported browser targets. A browser that is not on the
allowlist may not resolve a website origin; its requests can be rejected by the
RP even if the provider is selectable. The allowlist is a build-time snapshot and
must be refreshed when a browser's signing certificate or package entry changes.

### Matching rules

- Only `login` items with a non-empty password and a non-empty name are cached.
  Hosts and packages may both be empty; they are used for explicit matching and
  native-app inference.
- Browser/website match: the target `webDomain` equals a saved host, or ends with
  `.<saved host>`. Saved hosts have `www.` removed. Single-label hosts other than
  `localhost` are ignored so an entry like `com` cannot match every `.com` site.
- Browser requests that do not expose a web domain return no datasets. Package
  inference is never used for a browser, because that would offer a login such as
  "Google" on every page.
- Native-app explicit match: the target package exactly equals an item's
  `androidPackages` entry (case-insensitive).
- Native-app inferred match: tokens from the package name and application label
  (for example `reddit`, `gmail`, `github`) are compared with tokens from the
  login name and saved hosts. Generic tokens such as `com`, `android`, `mobile`,
  `app`, `login` and `account` are ignored, and a few short-brand aliases are
  recognised (`x`/`twitter`, `fb`/`facebook`, `ig`/`instagram`, `yt`/`youtube`).
  The service does not infer matches for browser packages.
- FlexiVault's own package is excluded.
- At most 8 datasets are returned for a request, ranked by explicit package,
  exact/subdomain host, then inferred token overlap. Each matching login is a
  separate dataset, so several saved accounts for the same site or app appear as
  separate choices in Android's autofill picker.
- A username field is filled only when the login has a non-empty username. The
  password field is filled when the form has one; an email-first page can produce
  a username-only dataset, and the next step needs another fill.

### Native module surface

`lib/native/autofill.ts` exposes:

```ts
isAutofillAvailable(): Promise<boolean>;
isAutofillEnabledOnDevice(): Promise<boolean>;
configureAutofill(items: VaultItem[]): Promise<void>;
clearAutofillCache(): Promise<void>;
openAutofillSettings(): Promise<void>;
```

The underlying module is `NativeModules.FlexiVaultAutofill`. It is registered in
`MainApplication.kt` and implemented in
`android/app/src/main/java/com/shivamchaudhary/flexiauth/autofill/`.

`lib/native/passkeys.ts` exposes:

```ts
isPasskeyProviderAvailable(): Promise<boolean>;
isPasskeyProviderEnabled(): Promise<boolean>;
readPendingPasskeys(): Promise<PendingPasskey[]>;
clearPendingPasskeys(credentialIds: string[]): Promise<void>;
syncNativePasskeys(items: VaultItem[]): Promise<void>;
clearNativePasskeys(): Promise<void>;
openPasskeySettings(): Promise<void>;
```

The native module is `NativeModules.FlexiVaultPasskeys`, implemented in
`android/app/src/main/java/com/shivamchaudhary/flexiauth/passkeys/`.
`PasskeyCryptoTest` covers base64url, CBOR/COSE layout, auth-data flags, the
four-byte counter, request parsing and ES256 signature verification.

`buildAutofillPayload()` in `lib/vault/autofill.ts` is unit-tested to ensure that
notes, TOTP secrets, cards and identities never enter the payload.

### Data model

`VaultItem` has two optional fields:

```ts
androidPackages?: string[];
passkey?: PasskeyRecord;
```

The editor accepts up to 20 valid Android package names. A package name must look
like `com.example.app`; invalid entries are ignored rather than matching nothing
silently at fill time.

A passkey-only login has no password. It still has a name, username, website and
`passkey` record, and is labelled **Passkey** in the vault. Editing it preserves
the passkey; deleting the item syncs a tombstone that removes the native mirror.

## Testing

On a physical Android 8+ device (or an emulator with a secure lock screen):

1. Build and install the native app. Expo Go is not sufficient.
2. Unlock the vault, open **Settings → Security → System autofill**, enable it,
   then tap **Android autofill settings** and select FlexiVault.
3. Add a login with `https://example.com` and, for a native test, an app package
   or a login name that matches the app label.
4. In Chrome, first enable **Chrome → Settings → Autofill and passwords →
   Autofill services → Autofill using another service**, restart Chrome, then
   open `https://example.com`, focus the login form and choose the FlexiVault
   suggestion. The biometric/PIN prompt should appear over Chrome, not switch to
   FlexiVault. Confirm it; the fields fill and Chrome remains in the foreground.
   If the vault has several logins for the same host, Android should list each
   one separately (label plus username); choose either to verify the right pair
   is filled.
5. Try a look-alike domain such as `example.com.evil.test`; no suggestion should
   appear.
6. In the native test app, focus its username/password form. Logins with its
   package, or with an app label/login name that matches, should be offered.
7. Cancel the authentication prompt; nothing is filled.
8. Lock FlexiVault, then focus the form again; the suggestion should still appear
   and should require the device prompt before filling.
9. Reboot without opening FlexiVault, then focus the form again; the suggestion
   should still appear after the device prompt.
10. Disable System autofill; the service no longer offers credentials.
11. On an email-first page such as Google's sign-in, focus only the email field.
    A username-only suggestion should fill the email. Continue to the password
    step and fill again.
12. Save prompt: submit a login form with a new username/password pair. The
    translucent save overlay should appear over the target app, not switch to
    FlexiVault. Choose **Save**, then repeat the form; the saved login should be
    offered. Lock the vault, submit another new login, choose **Save**, unlock
    FlexiVault, and confirm the queued credential is imported and the pending
    queue is empty.
13. Update prompt: submit a changed password for an existing login. Choose
    **Update**; the vault row should keep its notes, folder, favorite flag and
    TOTP seed, and its password should change.
14. Passkeys require an Android 14+ device. Open **Settings → Security →
    Android passkeys**, select FlexiVault, then create a passkey on a test
    relying party in Chrome. The device-auth prompt should appear over Chrome.
    Confirm that a **Passkey** login appears in the vault, lock FlexiVault, sign
    out, and sign in with the passkey. The prompt should still appear and the
    assertion should succeed while the app is locked.
15. Reboot without opening FlexiVault and repeat the passkey assertion. Cancel
    the prompt once and confirm the RP receives a cancellation, not a signature.
16. Delete the passkey item. After sync, Android should no longer offer that
    credential. On a second device, delete the same passkey and confirm the
    tombstone removes its native mirror too.
17. Use `adb logcat` only for high-level errors. Do not log passwords, private
    passkey scalars, `clientDataHash`, or assertion signatures.

Useful checks:

```bash
adb shell settings get secure autofill_service
adb shell dumpsys autofill
adb shell dumpsys credential
```

Do not log passwords from the service or the native module.

## iOS

iOS autofill requires a separate target and shared Keychain/App Group. It is not
covered by this implementation.

1. Add an `AutoFill Credential Provider` extension.
2. Share a Keychain access group between the app and the extension.
3. Store login identities in the shared Keychain, or store an encrypted cache
   whose key is in the shared Keychain.
4. Implement `ASCredentialProviderViewController` and return
   `ASPasswordCredential` after device authentication.
5. Add the autofill-credential-provider entitlement and provisioning.
6. Test in Settings → Passwords → AutoFill Passwords with Safari.

This needs an Apple developer account and App Store/sideload signing.

## Distribution

Android autofill uses platform APIs and AndroidX Biometric; it does not require
Google Play services or the "draw over other apps" permission. The QR scanner and
gallery-image decoder use ZXing Android Embedded (Apache-2.0), and
`expo-camera`/ML Kit is no longer part of the Android build. Signed APKs are
published on GitHub Releases; see [`PUBLISHING.md`](PUBLISHING.md).
