# System autofill on mobile

Status: **not implemented yet**. The mobile app currently stores, searches and
copies credentials, but it is not registered with Android or iOS as a system
password manager. Expo Go cannot provide a system autofill provider; this needs
a standalone native build.

This document is the implementation plan and the security contract for that
work. It is intentionally explicit so the feature is not shipped as a shortcut
that exposes passwords to other apps.

## What "works in other apps" means

When a user taps a login field in another app or a browser, the operating system
offers credentials from FlexiVault. Choosing one fills the field. The user does
not open FlexiVault first, and the other app never receives the whole vault.

- **Android:** an `AutofillService` declared in the manifest, with
  `android.permission.BIND_AUTOFILL_SERVICE`.
- **iOS:** an `AutoFill Credential Provider` app extension, enabled in
  Settings → Passwords → AutoFill Passwords.

Both are native OS integrations. A React Native screen cannot register itself.
The JS app can only configure and populate the native provider.

## Android design

### Components

```text
FlexiVault JS
  │  after unlock / item changes / lock
  ▼
AutofillBridge (native module)
  │  writes an encrypted cache
  ▼
files/autofill-cache.v1  ── AES-256-GCM with an Android Keystore key
  ▲
  │  reads and parses AssistStructure
FlexiVaultAutofillService (native, separate process entry point)
  │  Dataset + PendingIntent
  ▼
AutofillAuthActivity ── BiometricPrompt / device credential
  │  RESULT_OK
  ▼
System fills the target fields
```

### Data flow

1. The user enables **System autofill** in Settings. The app records the choice
   in `vault_meta` and sends a cache to the native bridge.
2. After every unlock and every item change, JS rebuilds a login-only cache:
   `id`, `name`, `username`, `password`, `urls`, optional `androidPackages`.
   The cache is written only while the vault is unlocked.
3. The native bridge encrypts the JSON with a random AES key held in the Android
   Keystore (`AutofillCacheKey`, AES/GCM/NoPadding) and writes
   `files/autofill-cache.v1`.
4. On lock, logout, reset, or disabling autofill, JS calls `clearAutofillCache()`
   and the native bridge deletes the file. The cache also expires after a short
   configurable window (default: 12 hours) and is rejected after a device reboot
   until the app is unlocked again.
5. When another app focuses a login field, Android calls
   `FlexiVaultAutofillService.onFillRequest`.
6. The service parses `AssistStructure`:
   - browser/website: use `ViewNode.webDomain` and match against saved URL
     hostnames;
   - native app: match `ViewNode.idEntry`/`autofillHints` for username/password
     and match the target package against saved `androidPackages`.
7. For each matching login, build a `Dataset` with `AutofillId` values for the
   username and password fields. Attach
   `Dataset.Builder.setAuthentication(pendingIntent, presentation)` so Android
   launches `AutofillAuthActivity` before filling.
8. `AutofillAuthActivity` is not exported. It shows `BiometricPrompt` with
   `BIOMETRIC_STRONG | DEVICE_CREDENTIAL` (API 30+) or
   `KeyguardManager.createConfirmDeviceCredentialIntent` (older versions). Only
   on success does it return `RESULT_OK`; Android then fills the dataset.
9. If there are no matches, return an empty `FillResponse` (or a "Save to
   FlexiVault" suggestion later). Do not offer every vault item to every app.

### Why not fill silently?

A malicious app can present a fake login form and ask Android for autofill. A
service that returns credentials without user action would hand them over.
Every dataset therefore requires a biometric or device-credential confirmation,
even when the vault was recently unlocked. This is the same reason Google
Password Manager and Proton Pass prompt before filling in many contexts.

### Native module surface

Add a local Expo module (or a config plugin that injects a React Native module):

```ts
type AutofillLogin = {
  id: string;
  name: string;
  username?: string;
  password?: string;
  urlHosts: string[];
  androidPackages: string[];
};

configureAutofill(logins: AutofillLogin[]): Promise<void>;
clearAutofillCache(): Promise<void>;
autofillAvailable(): Promise<boolean>;
openAutofillSettings(): Promise<void>;
```

- `configureAutofill` writes only login records with a non-empty password.
- It never accepts notes, cards, identities, TOTP secrets or the master key.
- The native module must reject calls when the app is locked. The JS layer is
  not the security boundary.
- `openAutofillSettings` launches
  `Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE` with the FlexiVault component.

### Data model additions

Add to `VaultItem`:

```ts
androidPackages?: string[];
```

The item editor gets an optional **Android app package** field for logins, and
can capture a package from a share intent later. Browser logins do not need it.
Without this field, native-app matching is impossible; matching only by app
label would be unsafe.

### Lifecycle hooks in JS

Call the bridge from:

- `unlock()` and biometric unlock, after `keyRef` is set;
- `addItem`, `updateItem`, `deleteItem`, `importItems`, and group renames;
- `lock()`, reset, disconnect, and app background if the auto-lock timer fires.

Debounce bulk changes (for example an import) so one encrypted write happens at
the end.

### Android manifest

```xml
<service
  android:name=".autofill.FlexiVaultAutofillService"
  android:permission="android.permission.BIND_AUTOFILL_SERVICE"
  android:exported="true">
  <intent-filter>
    <action android:name="android.service.autofill.AutofillService" />
  </intent-filter>
  <meta-data
    android:name="android.autofill"
    android:resource="@xml/autofill_service" />
</service>

<activity
  android:name=".autofill.AutofillAuthActivity"
  android:exported="false"
  android:theme="@style/Theme.Transparent" />
```

`res/xml/autofill_service.xml` points to the settings activity so the user can
open FlexiVault from Android's autofill settings.

### Testing

- Unit-test `AssistStructure` matching with fake view nodes for a browser domain,
  a native package, a look-alike domain, and a form with no password field.
- Instrument a device with a test app that has a username/password form and a
  saved package association.
- Verify canceling biometrics fills nothing.
- Verify locking the vault deletes the cache and the next autofill request offers
  nothing.
- Verify the cache is not readable before first unlock after a reboot.
- Verify no notes/cards/identities/TOTP secrets are present in the cache file.

## iOS design

This is a larger platform project and is not covered by an Expo Go workflow.

1. Add an `AutoFill Credential Provider` extension target to the iOS project.
2. Share a Keychain access group between the app and the extension.
3. The app writes login identities to the shared Keychain only while unlocked,
   or stores an encrypted cache keyed by a Keychain item.
4. The extension implements
   `ASCredentialProviderViewController.prepareCredentialList` and returns
   `ASPasswordCredentialIdentity` entries. On selection, it returns an
   `ASPasswordCredential` after device authentication.
5. Add the `com.apple.developer.authentication-services.autofill-credential-provider`
   entitlement and a matching App Group.
6. Test in Settings → Passwords → AutoFill Passwords with Safari and a native
   test app.

Expo does not generate this extension. It requires a custom native target,
entitlements, provisioning, and App Store/sideload signing. Treat it as a
separate milestone after Android.

## Phasing

1. **Android cache + settings toggle** — native module, encrypted cache, JS
   lifecycle hooks. No OS integration yet; verify the cache is correct and is
   wiped on lock.
2. **Android browser autofill** — `AutofillService`, web-domain matching,
   biometric-gated datasets. This covers the most common case.
3. **Android native-app matching** — `androidPackages` field, package matching,
   share-to-save flow.
4. **Hardening** — tamper checks, cache TTL, emulator tests, F-Droid dependency
   audit, no ML Kit/proprietary code.
5. **iOS** — separate extension target.

Do not merge step 2 without step 1's cache wipe tests. A plaintext password file
in the app sandbox is worse than no autofill.

## F-Droid impact

Android autofill is part of AndroidX/OS APIs and does not require Google Play
services. It is compatible with F-Droid. Do not use Google's
`androidx.credentials` Play Services backend for this feature; use the platform
`AutofillService` APIs.

The existing QR scanner's ML Kit dependency is a separate F-Droid blocker; see
[`PUBLISHING.md`](PUBLISHING.md).

## Decision needed

Before writing native code, choose the first target:

- **Android only** (recommended first): browser and native-app autofill on
  Android, with biometric confirmation.
- **Android and iOS**: doubles the native work and needs an Apple developer
  account and an iOS extension target.

The app also needs to add the optional `androidPackages` field before native-app
matching can work. Browser-only autofill can ship without it.
