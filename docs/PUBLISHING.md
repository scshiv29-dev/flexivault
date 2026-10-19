# Publishing FlexiVault

FlexiVault is distributed as a standalone Android APK. There is no Play Store
listing: personal builds go to GitHub Releases, and public distribution goes
through F-Droid.

| Target | Signing | Distribution |
| --- | --- | --- |
| Personal / friends | Your release keystore | GitHub Releases, direct APK |
| Public F-Droid | F-Droid signs from source | F-Droid repository |

The same `applicationId` (`com.shivamchaudhary.flexiauth`) must be used for both,
but Android will refuse to install one over the other because the signing keys
differ. Uninstall the personal build before installing the F-Droid build.

## Before the first release

1. Choose a FOSS license. F-Droid requires one. This repository uses
   **AGPL-3.0-only**; keep the full text in `LICENSE`, the
   `"license": "AGPL-3.0-only"` field in `package.json`, and the notice in the
   README. If you change the license, update the F-Droid metadata as well.
2. Confirm the version in both places:
   - `app.json` → `expo.version` and `expo.android.versionCode`
   - `android/app/build.gradle` → `versionName` and `versionCode`
3. Remove secrets and build artifacts from the tree:
   - no `.env`, `server/data/`, `*.jks`, `android/keystore.properties`
   - no `android/app/build/`, `*.apk`, `*.aab`
4. Run the checks:

   ```bash
   npx tsc --noEmit
   npm test
   cd server && npm test && cd ..
   cd extension && npm run check && npm test && cd ..
   ```

5. Commit and tag the exact source you will build. F-Droid builds from a commit,
   not from a local working tree.

## Personal APK

### 1. Create a release keystore once

```bash
keytool -genkeypair -v \
  -keystore keystore/flexivault-release.jks \
  -alias flexivault \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

`keystore/` and `*.jks` are ignored by Git. Store the keystore and its passwords
in a password manager and an offline backup. If you lose them you cannot update
an installed app; Android will reject an APK signed with a different key. If the
key leaks, anyone can publish a malicious update under your identity.

### 2. Configure local signing

```bash
cp android/keystore.properties.example android/keystore.properties
```

Edit `android/keystore.properties`:

```properties
storeFile=keystore/flexivault-release.jks
storePassword=…
keyAlias=flexivault
keyPassword=…
```

`android/keystore.properties` is ignored by Git. The path is relative to
`android/`. The Gradle file loads this file only when it exists, so F-Droid can
build an unsigned APK without it.

> **Native project warning.** This repository commits `android/`. If you run
> `npx expo prebuild --platform android --clean`, the generated Gradle files
> are recreated and the release-signing block can be overwritten. Re-apply it,
> or use the checked-in `android/` project without a clean prebuild. F-Droid
> uses the committed project and does not need prebuild.

### 3. Build the signed APK

```bash
cd android
./gradlew :app:assembleRelease
```

On Windows:

```powershell
cd android
.\gradlew.bat :app:assembleRelease
```

The APK is at:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Verify the signature and 16 KB alignment:

```bash
$ANDROID_HOME/build-tools/<version>/apksigner verify --verbose --print-certs \
  app/build/outputs/apk/release/app-release.apk

$ANDROID_HOME/build-tools/<version>/zipalign -c -P 16 -v 4 \
  app/build/outputs/apk/release/app-release.apk
```

For a Play-style bundle (not needed for GitHub or F-Droid):

```bash
./gradlew :app:bundleRelease
# android/app/build/outputs/bundle/release/app-release.aab
```

### 4. Publish on GitHub Releases

Create the repository once (required before F-Droid can clone it):

```bash
git init
git add .
git commit -m "FlexiVault 1.0.0"
git branch -M main
git remote add origin https://github.com/<you>/flexivault.git
git push -u origin main
```

With GitHub CLI:

```bash
gh repo create <you>/flexivault --public --source=. --remote=origin --push
```

Create a tag and a release with the APK and a checksum:

```bash
git tag -a v1.0.0 -m "FlexiVault 1.0.0"
git push origin v1.0.0

sha256sum android/app/build/outputs/apk/release/app-release.apk > app-release.apk.sha256
gh release create v1.0.0 \
  android/app/build/outputs/apk/release/app-release.apk \
  app-release.apk.sha256 \
  --title "FlexiVault 1.0.0" \
  --notes "First standalone release."
```

Or use the GitHub web UI: **Releases → Draft a new release → choose the tag →
upload the APK and checksum**.

### 5. Install and update

Android requires **Install unknown apps** permission for the browser or file
manager used to open the APK. Updates must use the same signing key and a
higher `versionCode`. Users do not need to uninstall for an update signed with
the same key.

## F-Droid

F-Droid builds the app from source on its own build servers and signs it with
F-Droid's key. You do not upload an APK.

### Requirements

- Public source repository with the exact buildable commit.
- A recognized FOSS license (`LICENSE` at the repository root).
- No proprietary dependencies, tracking, analytics, or remote code.
- `versionCode` increases for every release.
- A reproducible Gradle build.
- Metadata in the `fdroiddata` repository.

### 1. Make the source buildable from a clean checkout

F-Droid starts from a fresh clone and runs the build as an unprivileged user.
The checked-in `android/` project is used directly:

```bash
npm ci
cd android
./gradlew :app:assembleRelease
```

If you remove `android/` and rely on prebuild, the build entry needs an extra
init step:

```yaml
init: npm ci && npx expo prebuild --platform android --no-install
```

That is slower and less reproducible. Prefer committing the generated Android
project for F-Droid.

### 2. Handle the ML Kit dependency

This is the current blocker for public F-Droid inclusion.

`expo-camera`'s barcode scanner uses Google ML Kit:

```gradle
com.google.android.gms:play-services-code-scanner:16.1.0
com.google.mlkit:barcode-scanning:17.3.0
androidx.camera:camera-mlkit-vision:...
```

ML Kit and Google Play services are proprietary. F-Droid will reject a build
that packages them. `expo-camera` exposes:

```json
[
  "expo-camera",
  {
    "barcodeScannerEnabled": false
  }
]
```

That changes the dependencies to `compileOnly`, so they are not packaged in the
APK. It is **not sufficient by itself** for F-Droid: the dependency declarations
are still visible to F-Droid's scanner, and the merged manifest can still carry
the ML Kit `com.google.mlkit.vision.DEPENDENCIES` metadata. Pick one of these:

**Option A — F-Droid build without camera QR scanning.** Fork or patch
`expo-camera`'s Gradle and manifest to remove the three ML Kit lines and the
metadata, set `barcodeScannerEnabled: false`, and hide the QR scanner UI in that
build. Manual secret entry and pasted `otpauth://` links continue to work. This
is the smallest change, but users lose camera QR scanning in the F-Droid build.

**Option B — replace ML Kit with an open-source decoder.** Use ZXing
(Apache-2.0) or a pure-JS QR decoder behind a config plugin, and remove the
`expo-camera` barcode path entirely. This keeps QR scanning and is the better
long-term answer, but it is a native feature and needs its own build/test cycle.

Do not submit an APK that silently contains ML Kit and hope the scanner misses
it. The F-Droid review checks dependencies and the merged manifest.

### 3. Add F-Droid metadata

Fork `fdroiddata`, then add
`metadata/com.shivamchaudhary.flexiauth.yml`:

```yaml
Categories:
  - Security
License: AGPL-3.0-only
AuthorName: Shivam Chaudhary
SourceCode: https://github.com/<you>/flexivault
IssueTracker: https://github.com/<you>/flexivault/issues
Changelog: https://github.com/<you>/flexivault/releases
AutoName: FlexiVault

RepoType: git
Repo: https://github.com/<you>/flexivault.git

Builds:
  - versionName: 1.0.0
    versionCode: 1
    commit: v1.0.0
    subdir: android
    gradle:
      - yes
    output: app/build/outputs/apk/release/app-release-unsigned.apk
    init: npm ci
```

Notes:

- `commit` must be the tag or full commit SHA, not a branch.
- `subdir: android` means Gradle runs in the checked-in Android project.
- `init: npm ci` runs at the repository root before changing to `subdir`.
- `output` is relative to `subdir`. With no `android/keystore.properties`,
  Gradle produces `app-release-unsigned.apk`; F-Droid signs it.
- If the build server needs a specific NDK, add `ndk: <version>` using the NDK
  version your local `android/` build uses. Do not guess.
- If F-Droid's build server lacks the Node version Expo 57 needs, say so in the
  merge request; F-Droid maintainers can provide a newer build environment.

### 4. Test reproducibility

Build twice from the same commit and compare:

```bash
cd android
./gradlew clean :app:assembleRelease
cp app/build/outputs/apk/release/app-release-unsigned.apk /tmp/first.apk
./gradlew clean :app:assembleRelease
cp app/build/outputs/apk/release/app-release-unsigned.apk /tmp/second.apk
sha256sum /tmp/first.apk /tmp/second.apk
```

The hashes should match. If they do not, look for timestamps, absolute paths, or
non-deterministic generated files. F-Droid can still accept a non-reproducible
build, but reproducible builds are strongly preferred and may be required for
the "reproducible" badge.

### 5. Submit

1. Push the source and tag.
2. Add the metadata file in a branch of your `fdroiddata` fork.
3. Run `fdroid lint com.shivamchaudhary.flexiauth` and `fdroid rewritemeta`.
4. Open a merge request against `fdroiddata`.
5. Respond to review comments. After merge, the next F-Droid index update
   publishes the app.

Future releases: bump `versionCode` and `versionName`, tag the commit, and add a
new `Builds` entry. Do not edit an old build entry after it has shipped.

### 6. F-Droid limitations

- F-Droid signs with its own key. Users must uninstall a personal build before
  installing the F-Droid build, and vice versa.
- F-Droid updates can lag behind GitHub releases.
- The F-Droid build must not include Google ML Kit, Firebase, Crashlytics,
  analytics, or remote update code.
- `expo-camera` is MIT, AndroidX is Apache-2.0, and the rest of the app's
  dependencies are compatible. ML Kit is the outlier.

## iOS

There is no App Store or TestFlight plan in this document. A sideloaded iOS
build needs an Apple developer account and a provisioning profile. System-wide
AutoFill on iOS needs a separate **AutoFill Credential Provider** extension,
which is not part of the current Expo project. Treat iOS distribution and iOS
autofill as a separate project.

## Versioning checklist

For every release:

- [ ] Update `expo.version` in `app.json`.
- [ ] Increment `expo.android.versionCode` in `app.json`.
- [ ] Update `versionName` / `versionCode` in `android/app/build.gradle` if the
      Android project is checked in (it is).
- [ ] Run type checks and tests.
- [ ] Build a release APK and verify the signature.
- [ ] Tag the commit (`v1.0.0`).
- [ ] Publish the APK and SHA-256 on GitHub Releases.
- [ ] Add the F-Droid build entry only after the tag exists.

## Related docs

- [`COOLIFY.md`](COOLIFY.md) — host the sync server on Coolify.
- [`IMPORTING.md`](IMPORTING.md) — supported import formats and safety notes.
- [`AUTOFILL.md`](AUTOFILL.md) — Android/iOS system autofill design and status.
