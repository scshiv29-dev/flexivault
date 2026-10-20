# System autofill on mobile

Status: **Android implemented; device verification pending.** The Android app
registers a native `AutofillService`, keeps a login-only encrypted cache and
requires a biometric or device-credential check for every fill. iOS autofill is
not implemented.

Expo Go cannot exercise this feature. It needs a native APK built from
`android/` (for example `npx expo run:android` or a Gradle build).

## What works

- FlexiVault appears in **Settings → System → Languages & input → Autofill**
  (the exact menu varies by OEM) as an autofill service.
- Browser forms are matched by the page's `webDomain`: an exact saved hostname
  or a subdomain of it. A look-alike such as `example.com.evil.test` does not
  match `example.com`.
- Native Android forms are matched by the package name saved on the login.
- The item editor has an optional **Android app package** field for logins.
  Multiple packages can be separated by commas.
- Each dataset asks for biometrics or the device PIN/pattern/password before
  Android fills the username and password. Cancelling fills nothing.
- The cache is login-only. It contains no notes, cards, identities, TOTP seeds,
  settings or vault keys.
- The cache survives app locks and device reboots. It is cleared when autofill is
  disabled, the vault is reset, the cache is corrupted, or after 30 days.
- Settings shows whether the service is selected and opens the Android autofill
  settings screen.

Chrome may also show its built-in password manager. Modern Chrome builds only
route web forms to third-party autofill services after you opt in: **Chrome →
Settings → Autofill and passwords → Autofill services → Autofill using another
service**, then restart Chrome. FlexiVault datasets then appear through Android's
autofill UI. Other browsers use Android's picker directly.

If Chrome still hides third-party suggestions, disable Chrome's built-in password
manager or use Android's autofill picker.

Current limitations:

- Only login items are offered. Cards and identities can be stored in the vault
  but are not filled; passkeys and save/update prompts are not implemented.
- Only the first detected username/password pair in a form is filled. On an
  email-first sign-in page, a dataset can fill the username even though no
  password field is present yet; the password step needs a second fill.
- The service needs Android 8.0 (API 26) or newer.
- A native build is required; the feature is unavailable in Expo Go.
- iOS needs a separate AutoFill Credential Provider extension and Apple signing.

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
  │  parses AssistStructure, matches host/package
  │  builds Dataset + non-exported PendingIntent
  ▼
AutofillAuthActivity ── BiometricPrompt / Keyguard
  │  RESULT_OK
  ▼
Android fills the target fields
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

After authentication, the activity rechecks that the login is still present in
the unexpired cache. If the vault was reset, autofill was disabled, or the cache
expired while the prompt was open, the fill is cancelled instead of completing a
stale dataset.

The cache key is deliberately not auth-bound to a `CryptoObject`. Doing that
would require passing a `CryptoObject` from the service to the activity, and the
dataset values are built by the service before the prompt. The authentication
gate above is the security boundary; the cache is encrypted at rest and every
fill requires a device authentication prompt.

### Matching rules

- Only `login` items with a non-empty password and at least one saved host or
  package are cached.
- Browser/website match: the target `webDomain` equals a saved host, or ends with
  `.<saved host>`. Saved hosts have `www.` removed. Single-label hosts other than
  `localhost` are ignored so an entry like `com` cannot match every `.com` site.
- Native-app match: the target package exactly equals an item's
  `androidPackages` entry (case-insensitive).
- FlexiVault's own package is excluded.
- At most 8 datasets are returned for a request. Each matching login is a
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

`buildAutofillPayload()` in `lib/vault/autofill.ts` is unit-tested to ensure that
notes, TOTP secrets, cards and identities never enter the payload.

### Data model

`VaultItem` has an optional field:

```ts
androidPackages?: string[];
```

The editor accepts up to 20 valid Android package names. A package name must look
like `com.example.app`; invalid input is rejected instead of silently matching
nothing.

## Testing

On a physical Android 8+ device (or an emulator with a secure lock screen):

1. Build and install the native app. Expo Go is not sufficient.
2. Unlock the vault, open **Settings → Security → System autofill**, enable it,
   then tap **Android autofill settings** and select FlexiVault.
3. Add a login with `https://example.com` and, for a native test, an app package.
4. In Chrome, first enable **Chrome → Settings → Autofill and passwords →
   Autofill services → Autofill using another service**, restart Chrome, then
   open `https://example.com`, focus the login form and choose the FlexiVault
   suggestion. Confirm biometrics/PIN. The fields fill. If the vault has several
   logins for the same host, Android should list each one separately (label plus
   username); choose either to verify the right pair is filled.
5. Try a look-alike domain such as `example.com.evil.test`; no suggestion should
   appear.
6. In the native test app, focus its username/password form; only logins with its
   package should be offered.
7. Cancel the authentication prompt; nothing is filled.
8. Lock FlexiVault, then focus the form again; the suggestion should still appear
   and should require the device prompt before filling.
9. Reboot without opening FlexiVault, then focus the form again; the suggestion
   should still appear after the device prompt.
10. Disable System autofill; the service no longer offers credentials.
11. On an email-first page such as Google's sign-in, focus only the email field.
    A username-only suggestion should fill the email. Continue to the password
    step and fill again.

Useful checks:

```bash
adb shell settings get secure autofill_service
adb shell dumpsys autofill
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
Google Play services. The QR scanner uses ZXing Android Embedded (Apache-2.0),
and `expo-camera`/ML Kit is no longer part of the Android build. Signed APKs are
published on GitHub Releases; see [`PUBLISHING.md`](PUBLISHING.md).
