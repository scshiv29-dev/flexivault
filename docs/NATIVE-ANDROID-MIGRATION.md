# Moving the mobile app from React Native to native Android

**Status:** proposed. The app is still Expo SDK 57 / React Native 0.86.3.
**Goal:** a smaller install and faster startup and unlock on Android.
**Baseline build:** `dist/FlexiVault-1.0.4-test.apk`, version 1.0.4 (`versionCode` 5).

## Summary

Replace the Expo/React Native UI and TypeScript vault logic with a Kotlin and
Jetpack Compose app, keeping the same package ID, signing key, local database
and sync format so existing users upgrade in place.

- **Space:** the release APK is 108.3 MiB, but 62.4 MiB of that is native
  libraries for CPU architectures a given phone does not use, and R8 is off.
  Fixing both needs no migration. The migration's own saving is the remaining
  React Native runtime: about 26 MiB per architecture plus its share of the DEX.
- **Performance:** no runtime numbers exist yet. The code points to specific
  costs (below), but they are hypotheses until phase 0 measures them.
- **Cost:** the iOS and web builds of the app are dropped, and about 15,000 lines
  of TypeScript are rewritten. The server and browser extension do not change.

Phase 0 is therefore also the decision gate. It ships the cheap size fixes and
records real numbers, so the rewrite is judged against the improved app rather
than today's 108 MiB.

## Where the space goes

Measured by reading the zip entries of the 1.0.4 release APK. Native libraries
and the JS bundle are stored uncompressed, so these sizes are also what they
occupy on disk.

| Contents | Size (MiB) | Note |
| --- | ---: | --- |
| `lib/x86` | 23.68 | Emulators and rare devices |
| `lib/x86_64` | 23.11 | Emulators and rare devices |
| `lib/arm64-v8a` | 22.50 | Almost all current phones |
| `lib/armeabi-v7a` | 15.56 | Older 32-bit phones |
| DEX (4 files) | 14.46 | 40.68 MiB uncompressed; not shrunk by R8 |
| Resources | 4.78 | Includes 25 font files, 2.55 MiB |
| JS bundle | 3.15 | `assets/index.android.bundle` |
| Other | 0.19 | |
| **Total entries** | **107.4** | 108.3 MiB as a file |

Two build settings cause most of this:

- `reactNativeArchitectures` in `android/gradle.properties` lists all four ABIs,
  and `.github/workflows/release.yml` publishes the one universal APK from
  `:app:assembleRelease`. Because `expo.useLegacyPackaging=false` keeps libraries
  uncompressed inside the APK, a sideloaded install keeps all four on disk.
- `android.enableMinifyInReleaseBuilds` is not set, so `minifyEnabled` and
  `shrinkResources` are both false.

### The 22.50 MiB of arm64 libraries

| Library | MiB | Library | MiB |
| --- | ---: | --- | ---: |
| `libreactnative.so` | 6.66 | `libworklets.so` | 1.05 |
| `libhermesvm.so` | 2.36 | `libreact_codegen_rnsvg.so` | 0.75 |
| `libexpo-sqlite.so` | 1.75 | `libzstd-kmp.so` | 0.70 |
| `libappmodules.so` | 1.63 | `libnative-imagetranscoder.so` | 0.56 |
| `libreanimated.so` | 1.43 | `libstatic-webp.so` | 0.48 |
| `libexpo-modules-core.so` | 1.43 | `libjsi.so` | 0.39 |
| `libc++_shared.so` | 1.23 | `libgifimage.so` | 0.30 |
| `libreact_codegen_rnscreens.so` | 1.14 | 8 others, each under 0.2 | 0.63 |

None of these are the app's own native code: the Kotlin in this repository
compiles to DEX. `AutofillVaultReader` already reads the vault with the
framework's `android.database.sqlite`, so `libexpo-sqlite.so` is not needed
either. A native build should be able to ship no `.so` files, which would also
remove the ABI problem and any 16 KB page-size checks. Confirm this in phase 2,
since a Compose or AndroidX dependency may bring a small library of its own.

### The DEX

The APK holds 31,482 classes. This counts classes, not bytes, and before R8.

| Package | Classes | Share |
| --- | ---: | ---: |
| `androidx/compose` | 10,650 | 33.8% |
| `expo/modules` | 4,329 | 13.8% |
| `com/facebook` | 3,272 | 10.4% |
| `kotlin/reflect` | 2,014 | 6.4% |
| `com/google` | 1,857 | 5.9% |
| `com/swmansion` | 788 | 2.5% |

Compose arrives through `expo-modules-core`, so choosing Compose adds no new
dependency in practice. Today it ships unshrunk. In the native build R8 keeps
only what the screens use.

### Size by stage

| Stage | Approx. MiB | Basis |
| --- | ---: | --- |
| Today, universal APK | 108.3 | Measured |
| Phase 0, arm64-only APK, no R8 | 45.9 | Measured total minus the other three ABIs |
| Phase 0, arm64-only with R8 and pruned fonts | Below 45.9 | Build to measure |
| Native app, before R8 | About 20 | Above minus arm64 libraries and JS bundle; DEX would also lose its RN classes |
| Native app, with R8 | **Budget: 15 or less** | A target to enforce, not a prediction |

## Performance: what the code suggests

Nothing here has been benchmarked. Each row is a hypothesis for phase 0 to test.

| Area | Today | Native | Expected gain |
| --- | --- | --- | --- |
| Cold start | Load native libraries, start Hermes, run the bundle, then draw (`MainApplication.onCreate`, `app/_layout.tsx`) | Compose draws straight from the process start | High |
| Autofill and passkey cold start | Services share the app's process, and `MainApplication.onCreate` calls `loadReactNative` before they can respond, though they use no React Native | No React Native to load | High for time-to-fill; measure it first because this is the most frequent background path |
| Unlock with a large vault | `decryptRows` in `lib/state/vault-provider.tsx` decrypts every item in a synchronous loop on the JS thread, with AES-GCM in JavaScript (`@noble/ciphers`) | `javax.crypto` on a background dispatcher, normally hardware accelerated | High, scaling with vault size |
| Saving and sync | `toStoredItems` re-encrypts in JavaScript | Same native crypto | Medium |
| TOTP screen | HMAC-SHA1 in TypeScript (`lib/crypto/`); one shared clock, already designed to avoid per-row timers | Same design in Compose | Low to medium |
| PBKDF2 | Already native (`FlexiVaultCryptoModule`) | Unchanged | **None** |
| Autofill matching, passkey signing | Already Kotlin | Unchanged | **None** once the process is up |

Memory should also fall without the Hermes heap and React trees, but the amount
needs measuring.

### How to measure

Use a release build on a physical low-end arm64 phone, with the same seeded
vaults (100 and 1,000 items) on each build. Emulator timings are not comparable.

| Metric | Method | Gate for the native build |
| --- | --- | --- |
| Install footprint | Settings app size, and `adb shell dumpsys package` paths with `du` | 15 MiB APK budget |
| Cold start to first frame | Macrobenchmark `StartupTimingMetric`, 10 runs | Better than the RN median |
| Time to fill from a killed process | Timed from an autofill request to dataset returned | Better than the RN median |
| Unlock to usable list, both vaults | Trace from password submit to first list frame, excluding PBKDF2 | Better than the RN median |
| Idle and vault-list memory | `adb shell dumpsys meminfo` PSS | Lower than RN |
| Scroll jank, 1,000 items | `adb shell dumpsys gfxinfo` or `FrameTimingMetric` | No worse than RN |

## What is already native, and what is not

| Code | Lines | Fate |
| --- | ---: | --- |
| Kotlin with no React Native imports | 4,030 | Kept: autofill, passkeys, crypto |
| Kotlin bridge code and app entry points | 798 | Replaced; keep the scanner logic in `FlexiVaultQrScannerModule` |
| `lib/` excluding `words.ts` | 5,378 | Port to Kotlin |
| `lib/vault/words.ts` | 7,783 | Move to a raw resource (passphrase word list) |
| `app/` (21 route files) | 6,946 | Rewrite in Compose |
| `components/` (22 files) | 2,619 | Rewrite in Compose |

The largest screens are `settings` (897), `item/edit` (863), `scan` (625),
`item/[id]` (590), the vault list (556), `settings/server` (530) and `import`
(506). `lib/state/vault-provider.tsx` (1,428) is the hardest single file: it owns
the in-memory key, locking, sync races and pending imports, and it becomes the
Kotlin vault repository.

## What must not change

An update that breaks any of these can lock users out of their vaults.

| Contract | Detail | Where it lives |
| --- | --- | --- |
| App identity | `com.shivamchaudhary.flexiauth`, same signing key, `versionCode` above 5 | `android/app/build.gradle` |
| Vault database | `filesDir/SQLite/flexivault.db`, tables `vault_meta` and `vault_items`, same meta keys | `lib/store/db.ts`, `AutofillVaultReader.kt` |
| Legacy authenticator import | `flexiauth` database, `verifydb` table | `lib/store/db.ts` |
| Secrets | `flexivault.token` and `flexivault.biometric_key`, in `expo-secure-store`'s own Keystore-wrapped format | `lib/store/session.ts`, `expo-secure-store/android` |
| Encrypted item format | `v1.<nonce>.<ciphertext>`, base64, AES-256-GCM, 12-byte nonce, JSON plaintext | `lib/vault/crypto.ts`, `extension/src/crypto.js` |
| Key derivation | NFKC password, PBKDF2-SHA256, 64 bytes, stored iteration count (default 210,000), split into a 32-byte key and auth material | `lib/vault/crypto.ts` |
| Server auth hash | SHA-256 of auth material plus `flexivault:auth:v1` | `lib/vault/crypto.ts` |
| Key check | SHA-256 of the encryption key | `lib/vault/crypto.ts` |
| Native stores | Autofill cache, pending saves, passkey store, and biometric unlock key stay readable | `autofill/`, `passkeys/` |
| Entry points | `flexivault://` scheme, autofill and credential provider declarations | `AndroidManifest.xml` |
| Backup rules | `@xml/secure_store_backup_rules` and `secure_store_data_extraction_rules` come from `expo-secure-store`; add equivalents when it is removed | `AndroidManifest.xml` |

**Secrets need a one-time migration.** Port the `expo-secure-store` read path,
including its `AESEncryptor` and `HybridAESEncryptor` schemes, and re-wrap values
into a native store on first launch. If a value cannot be read, fail safely: ask
the user to sign in again for the token, and to re-enable biometrics after a
master-password unlock. Never delete the vault because a secret is unreadable.

## Decisions

- **Compose, single-activity.** It is the current Android default and is already
  in the dependency tree, and R8 makes the size impact manageable.
- **Framework SQLite, not Room.** The schema is two simple tables owned by an
  existing format, and `AutofillVaultReader` already uses the framework API.
- **Keep the database in place.** No schema change means a rollback stays possible.
- **`HttpURLConnection` or OkHttp, chosen in phase 1** by what is smallest after
  R8. `lib/vault/api.ts` makes only simple JSON calls.
- **Full cutover rather than a hybrid.** Hosting native screens inside React
  Native gives no size gain until the last screen moves, and two runtimes would
  share ownership of the in-memory key throughout. The rewrite is developed on a
  long-lived branch and released once.

## What is lost

- **iOS:** the app has no iOS autofill, passkeys or QR scanning today, but the
  build would be gone. A future iOS app would be a separate project.
- **Web build:** the Expo web export goes away.
- **Expo tooling:** Expo Go, EAS and `expo prebuild` no longer apply.
  `eas.json`, `.easignore`, `app.json`, and the README's Expo sections are removed.
  `scripts/test-everything.mjs` starts Metro for the app, so that part must change.
- **Shared logic:** the extension already has its own crypto in `extension/src`,
  so Kotlin becomes a third implementation alongside the server's. Golden vectors
  (phase 1) keep them compatible.

## Plan

### Phase 0: quick wins and the decision gate

1. Build per-ABI APKs, and publish `arm64-v8a` plus `armeabi-v7a` in
   `release.yml`. Keep a universal APK only if a real user needs it.
2. Enable R8 and resource shrinking. Test every flow, because reflection in React
   Native and Expo may need keep rules.
3. Prune the unused `@expo/vector-icons` fonts. The code uses only Feather and
   Ionicons, while the APK carries 25 font files.
4. Run the benchmarks above and record them here.

**Gate:** continue only if the remaining size and the measured startup, autofill
and unlock costs still justify the rewrite and the loss of iOS and web.

### Phase 1: Kotlin core, no UI

Port `lib/vault`, `lib/crypto`, `lib/store` and the vault provider's logic.
Generate golden vectors from the existing TypeScript for envelopes, key
derivation, auth hash, TOTP/HOTP, `otpauth://` parsing and importer output, and
run them against Kotlin in `testDebugUnitTest`. Port the eight existing Jest suites.
Test that the extension can decrypt Kotlin output, and the reverse.

### Phase 2: Compose UI

Build with a separate debug `applicationId` so it installs next to the current
app. Order: unlock and create vault, vault list and item view, codes, edit and
new item, scan, import, groups, security, settings and 2FA. Replicate the theme
from `lib/theme.tsx`, and add an R8-on size check to CI that fails over budget.

### Phase 3: upgrade testing

Install real 1.0.4 builds, populate them, then upgrade to the native build:

- Vault, groups and TOTP intact, and the session token still valid.
- Biometric unlock either works or fails safely as described above.
- Autofill while locked and unlocked, save and update, and passkeys on Android 14+.
- Sync in both directions with the server and extension.
- Backup and restore, a pre-vault `flexiauth` database, and 16 KB page-size devices.

### Phase 4: cutover

Remove `node_modules`-based Gradle wiring, the React Native plugin, and the JS
source tree. Update CI, `README.md`, `docs/AUTOFILL.md` and `docs/PUBLISHING.md`,
then release as a new major version.

**Rollback:** Android blocks version downgrades, so rollback means shipping the
last React Native code with a higher `versionCode`. This works because the
database format is unchanged, but it requires secrets to remain readable. So keep
the old `expo-secure-store` entries for one release after migrating them, and
tag the last React Native commit.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Crypto or format mismatch | Vault or sync failure | Golden vectors and extension round-trip tests before any UI work |
| `expo-secure-store` format differs across versions | Forced sign-in, biometrics reset | Support each scheme, fail safely, test real upgrades |
| Parity gaps in a long rewrite | Regressions at cutover | Screen checklist, feature freeze or dual-porting during phase 2 |
| Secrets in memory | Master key handling differs on the JVM | Review key lifetime in a security pass; keep lock and reset invalidation behaviour |
| Size budget missed | Goal not met | CI size check from the start of phase 2 |
