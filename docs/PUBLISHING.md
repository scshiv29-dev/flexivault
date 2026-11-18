# Releasing FlexiVault

FlexiVault ships through **GitHub Releases** and the **GitHub Container
Registry**. There is no Play Store listing. F-Droid publishing is out of scope
for now; the current release channel is GitHub.

| Artifact | Built by | Where it goes |
| --- | --- | --- |
| Signed Android APK | `.github/workflows/release.yml` on a `v*` tag | GitHub Release assets |
| Browser extension ZIP | `release.yml` on a `v*` tag | GitHub Release assets; upload to Chrome Web Store / Edge Add-ons |
| Debug APK | `.github/workflows/ci.yml` on `main` / pull requests | Actions artifact |
| Server image | `release.yml` on a tag, `server-image.yml` on `main` | `ghcr.io/scshiv29-dev/flexivault-server` |

The app uses `com.shivamchaudhary.flexiauth` as its application ID. Always keep
the same release signing key: Android refuses to install an update signed by a
different key. Losing the keystore means every user must uninstall the old app
before installing a new build.

## 1. Create the release keystore once

The keystore, `android/keystore.properties`, `*.jks`, `*.apk` and `*.aab` are
gitignored. Never commit them.

```powershell
New-Item -ItemType Directory -Force android\keystore
keytool -genkeypair -v `
  -keystore android\keystore\flexivault-release.jks `
  -alias flexivault `
  -keyalg RSA `
  -keysize 4096 `
  -validity 10000
```

Back up the `.jks` file and its passwords somewhere safe and offline. This key
is the update identity for the app.

For a local release build, create `android/keystore.properties` from
`android/keystore.properties.example` and fill in the real values:

```properties
storeFile=keystore/flexivault-release.jks
storePassword=your-keystore-password
keyAlias=flexivault
keyPassword=your-key-password
```

Paths in this file are relative to the `android/` directory.

## 2. Add the GitHub Actions secrets

Open **Settings → Secrets and variables → Actions → New repository secret** and
add:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 of `android/keystore/flexivault-release.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `flexivault` |
| `ANDROID_KEY_PASSWORD` | Key password |

Create the base64 value without line wrapping:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes("android/keystore/flexivault-release.jks")
)
```

```bash
# Linux/macOS equivalent
base64 -w0 android/keystore/flexivault-release.jks
```

The release workflow writes `android/keystore.properties` and the `.jks` file
inside the runner from these secrets. Nothing is stored in the repository.

## 3. Keep the version numbers in sync

Before a release, update:

- `app.json` → `expo.version` and `expo.android.versionCode`
- `android/app/build.gradle` → `versionName` and `versionCode` (the Android
  project is checked in)

`versionCode` must increase for every published APK. `versionName` is the
human-readable version shown on the device.

For an extension update, also update `extension/manifest.json` and
`extension/package.json` to the same version. The extension `npm run check`
fails if those two files disagree. The extension version is independent of the
APK version, but bump it for every store upload.

## 4. Build a release locally (optional)

```powershell
cd android
.\gradlew.bat --no-daemon :app:assembleRelease
```

With a valid `android/keystore.properties`, the output is one APK per ABI:

```text
android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
android/app/build/outputs/apk/release/app-armeabi-v7a-release.apk
```

Without signing material, Gradle produces
`app-<abi>-release-unsigned.apk`, which Android will not install. That is useful
for inspecting the package, not for distribution.

Release builds have R8 enabled. To test one on an x86_64 emulator:

```bash
./gradlew :app:assembleRelease -PreactNativeArchitectures=x86_64 -Pflexivault.releaseAbis=x86_64
```

Verify the signature:

```powershell
& "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --print-certs `
  android\app\build\outputs\apk\release\app-arm64-v8a-release.apk
```

## 5. GitHub Actions

### CI — `.github/workflows/ci.yml`

Runs on every push to `main` and on pull requests:

- type-checks the app with `tsc`
- runs the mobile, server and extension tests
- builds a debug APK and uploads `flexivault-debug-apk` as an Actions artifact

This is the quickest installable build for device testing, but it is debug-signed
and is not a public release.

### Release — `.github/workflows/release.yml`

Runs when a tag matching `v*` is pushed, or manually from the Actions tab:

1. verifies the source and tests
2. materializes the signing keystore from repository secrets
3. builds one release APK each for `arm64-v8a` and `armeabi-v7a`
4. verifies the signatures and writes SHA-256 checksums
5. creates or updates the GitHub Release and uploads the APKs + checksums
6. packages the browser extension as
   `FlexiVault-Extension-<version>.zip` and attaches it to the same release
7. builds and pushes the server image to GHCR

A tagged release **fails** if the four signing secrets are missing. This is
deliberate: do not publish an unsigned or debug-signed APK as a release.

A manual **Run workflow** builds the APK and extension zip as artifacts and
pushes an `edge` server image, but does not create a GitHub Release. Use a tag
for releases.

### Server image — `.github/workflows/server-image.yml`

Runs on every push to `main` and manually. It publishes:

```text
ghcr.io/scshiv29-dev/flexivault-server:edge
ghcr.io/scshiv29-dev/flexivault-server:sha-<commit>
```

The `release.yml` tag build publishes:

```text
ghcr.io/scshiv29-dev/flexivault-server:latest
ghcr.io/scshiv29-dev/flexivault-server:v1.0.1
ghcr.io/scshiv29-dev/flexivault-server:sha-<commit>
```

The first GHCR push creates a private package. Open the package settings on
GitHub and set its visibility to **public**, or add registry credentials in
Coolify.

## 6. Cut a release

```powershell
# 1. Update app.json and android/app/build.gradle versions first.
npx tsc --noEmit
npx jest --runInBand
cd server
npm test
cd ..\extension
npm run check
npm test
cd ..

# 2. Commit and tag.
git add -A
git commit -m "Release 1.0.1"
git tag -a v1.0.1 -m "FlexiVault 1.0.1"
git push origin main
git push origin v1.0.1
```

Wait for the **Release** workflow. When it finishes:

- **Releases** contains `FlexiVault-1.0.1-arm64-v8a.apk` (almost all current
  phones), `FlexiVault-1.0.1-armeabi-v7a.apk` (older 32-bit phones), a `.sha256`
  file for each, `FlexiVault-Extension-1.0.1.zip` and
  `FlexiVault-Extension-1.0.1.zip.sha256`.
- GHCR contains `latest`, `v1.0.1` and the commit tag for the server image.

If the tag already exists, delete the remote tag and recreate it only after
understanding that users may already have downloaded the old release.

### Updates through Obtainium

[Obtainium](https://github.com/ImranR98/Obtainium) installs and updates the APK
straight from GitHub Releases, so publishing a tag is all it needs. Users add the
app with this link (it opens Obtainium, or offers to install it):

```text
https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/scshiv29-dev/flexivault
```

or by pasting `https://github.com/scshiv29-dev/flexivault` into **Add App**.

Obtainium relies on these release rules. Keep them when changing the workflow:

- **Same signing key forever.** Android rejects an update signed with a
  different key, so Obtainium cannot install it. Back up the release keystore.
- **Tag matches `versionName`.** Obtainium compares the installed app's
  `versionName` (`1.0.5`) with the release tag after dropping the `v`
  (`v1.0.5`). The release workflow fails if the tag, `app.json` and
  `android/app/build.gradle` disagree.
- **ABI in the APK file name.** Each release has one APK per ABI, so the asset
  names keep `arm64-v8a` / `armeabi-v7a`. With **Attempt to filter APKs by CPU
  architecture** turned on in the app's Obtainium settings, Obtainium picks the
  right APK by itself. Without it, Obtainium asks which APK to install on every
  update, and background updates do not run.
- **Only app APKs end in `.apk`.** Checksums (`.apk.sha256`) and the extension
  zip are ignored, so do not attach other `.apk` files (such as a debug build)
  to a release.
- **No drafts or pre-releases for stable builds.** Obtainium skips pre-releases
  unless the user opts in.

### Publish the extension to a browser store

The release zip is ready to upload, but a store listing is **not** created by
the tag workflow. Chrome Web Store and Microsoft Edge Add-ons each require a
one-time developer account, listing assets, a public privacy policy, review
notes with a working demo account, and manual review. Follow
[`extension/STORE.md`](../extension/STORE.md) for the exact steps and copy. The
draft privacy policy is [`docs/EXTENSION-PRIVACY.md`](EXTENSION-PRIVACY.md); host
it at a public URL before submitting.

### Firefox: self-hosted updates (unlisted XPI)

Firefox lets an add-on update from your own server, the way Obtainium updates
the APK, as long as addons.mozilla.org (AMO) signs it. An **unlisted** add-on is
signed automatically (usually within minutes) and never appears in the AMO
store.

`extension/scripts/build-firefox.mjs` builds `extension/dist/firefox` from the
same code. Its manifest differs from the Chrome one in three ways:

- `background.scripts` (an event page) replaces `background.service_worker`.
- `browser_specific_settings.gecko` sets the add-on ID
  `flexivault@scshiv29-dev.github.io` and Firefox 140 as the minimum version.
  **Never change the ID.** Firefox treats a new ID as a different add-on, and
  installed copies stop updating.
- `update_url` points at
  `https://github.com/scshiv29-dev/flexivault/releases/latest/download/firefox-updates.json`.

One-time setup:

1. Sign in at <https://addons.mozilla.org/developers/> and accept the
   developer agreement.
2. Open **Tools → Manage API Keys** and generate credentials.
3. Add them as repository secrets: `AMO_JWT_ISSUER` (the JWT issuer, which looks
   like `user:12345:678`) and `AMO_JWT_SECRET`.

On every `v*` tag, the release workflow's **Sign the Firefox extension** job:

1. Builds and lints the add-on.
2. Signs it on AMO through the unlisted channel.
3. Attaches `FlexiVault-Firefox-<version>.xpi`, its `.sha256` and
   `firefox-updates.json` to the release.

Without the secrets, the job only builds and lints the add-on, then prints a
warning. Firefox checks `update_url` about once a day and installs the new
version. Users can also run **Check for Updates** from `about:addons`.

Rules this depends on:

- **Every release needs a new version.** AMO signs each version only once.
- **Keep `firefox-updates.json` on the latest release.** `update_url` resolves
  through `releases/latest`, so it must not be a draft or a pre-release, and
  each stable release must include the file.
- **First install:** users open the `.xpi` link from the release page in Firefox
  and accept the prompt. Firefox needs to be 140 or newer (the current ESR
  qualifies).
- **Passkey quick unlock** may not work in Firefox, because WebAuthn from
  `moz-extension://` pages is limited. The master password and authenticator
  code unlock do not depend on it.

Before the first signed release, load `extension/dist/firefox/manifest.json`
from `about:debugging#/runtime/this-firefox` (**Load Temporary Add-on**). Check
unlock, sync, autofill and the save prompt.

## 7. Self-host with Coolify

[`docker-compose.coolify.yml`](../docker-compose.coolify.yml) pulls the published image:

```yaml
image: "ghcr.io/scshiv29-dev/flexivault-server:${FLEXIVAULT_IMAGE_TAG:-latest}"
```

Set `FLEXIVAULT_IMAGE_TAG` to a release tag such as `v1.0.1` for reproducible
deployments, or to `edge` to follow `main`. Keep the named data volume (Coolify
prefixes its name); it holds SQLite, the JWT key and the server encryption key.
The public domain must route to the container's internal port `8787`; see
[`COOLIFY.md`](COOLIFY.md) for the correct domain format and volume migration
notes.

To deploy without Coolify:

```bash
docker run -d \
  --name flexivault-server \
  -p 8787:8787 \
  -v flexivault-data:/data \
  -e REGISTRATION_OPEN=true \
  ghcr.io/scshiv29-dev/flexivault-server:v1.0.1
```

See [`COOLIFY.md`](COOLIFY.md) for domains, backups and environment variables.

## 8. Verify a release

```powershell
# APK
& "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --print-certs `
  FlexiVault-1.0.1.apk
Get-FileHash FlexiVault-1.0.1.apk -Algorithm SHA256

# Compare with the .sha256 file on the release page.
```

```powershell
# Extension zip
Get-FileHash FlexiVault-Extension-1.0.1.zip -Algorithm SHA256
tar -tf FlexiVault-Extension-1.0.1.zip | Select-Object -First 12
# manifest.json must be at the zip root; entry order does not matter.
```

```bash
# Server image
docker buildx imagetools inspect \
  ghcr.io/scshiv29-dev/flexivault-server:v1.0.1
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Release workflow fails at “Require signing secrets” | Add all four Android signing secrets, then re-run the workflow. |
| Release contains an unsigned APK | The keystore step was skipped. Do not distribute it; fix the secrets and rebuild. |
| APK will not install over an older build | The signing keys differ. Uninstall the old app, or use the original keystore. |
| Obtainium always shows an update for the installed version | The tag and the APK's `versionName` differ. Keep `app.json`, `build.gradle` and the tag in sync. |
| Obtainium asks which APK to install | Turn on **Attempt to filter APKs by CPU architecture** for FlexiVault in Obtainium. |
| `versionCode` already exists | Increment it in `app.json` and `android/app/build.gradle`, commit, and tag a new version. |
| GHCR pull is denied | The package is private. Make it public or add registry credentials in Coolify. |
| Coolify still runs the old server | `FLEXIVAULT_IMAGE_TAG` points at the old tag, or `latest` was not re-pulled. Re-pull/redeploy. |
| No release assets | The workflow ran manually instead of from a `v*` tag; manual runs only upload Actions artifacts. |
| Release has the APK but no extension zip | The extension job failed or was skipped. It runs after the Android job; check that log and re-run failed jobs. |
| Chrome says the manifest is missing | The zip contains a nested `extension/` folder. Rebuild with the runtime files at the zip root. |
| Chrome rejects the extension version | Bump `extension/manifest.json` and `extension/package.json` above the published version, rerun `npm run check`, and rebuild. |

## Related documents

- [`AUTOFILL.md`](AUTOFILL.md) — Android autofill design, security model and
  device-test checklist.
- [`COOLIFY.md`](COOLIFY.md) — self-hosting the server on Coolify.
- [`IMPORTING.md`](IMPORTING.md) — password-manager import formats.
- [`EXTENSION-PRIVACY.md`](EXTENSION-PRIVACY.md) — public privacy-policy draft
  for the Chrome Web Store / Edge Add-ons listing.
- [`../extension/STORE.md`](../extension/STORE.md) — extension package,
  store listing copy, permission justifications and review checklist.
