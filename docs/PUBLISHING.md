# Releasing FlexiVault

FlexiVault ships through **GitHub Releases** and the **GitHub Container
Registry**. There is no Play Store listing. F-Droid publishing is out of scope
for now; the current release channel is GitHub.

| Artifact | Built by | Where it goes |
| --- | --- | --- |
| Signed Android APK | `.github/workflows/release.yml` on a `v*` tag | GitHub Release assets |
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

## 4. Build a release locally (optional)

```powershell
cd android
.\gradlew.bat --no-daemon :app:assembleRelease
```

With a valid `android/keystore.properties`, the output is:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Without signing material, Gradle produces
`app-release-unsigned.apk`, which Android will not install. That is useful for
inspecting the package, not for distribution.

Verify the signature:

```powershell
& "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --print-certs `
  android\app\build\outputs\apk\release\app-release.apk
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
3. builds `app-release.apk`
4. verifies the signature and writes a SHA-256 checksum
5. creates or updates the GitHub Release and uploads the APK + checksum
6. builds and pushes the server image to GHCR

A tagged release **fails** if the four signing secrets are missing. This is
deliberate: do not publish an unsigned or debug-signed APK as a release.

A manual **Run workflow** builds the APK as an artifact and pushes an `edge`
server image, but does not create a GitHub Release. Use a tag for releases.

### Server image — `.github/workflows/server-image.yml`

Runs on every push to `main` and manually. It publishes:

```text
ghcr.io/scshiv29-dev/flexivault-server:edge
ghcr.io/scshiv29-dev/flexivault-server:sha-<commit>
```

The `release.yml` tag build publishes:

```text
ghcr.io/scshiv29-dev/flexivault-server:latest
ghcr.io/scshiv29-dev/flexivault-server:v1.0.0
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
git commit -m "Release 1.0.0"
git tag -a v1.0.0 -m "FlexiVault 1.0.0"
git push origin main
git push origin v1.0.0
```

Wait for the **Release** workflow. When it finishes:

- **Releases** contains `FlexiVault-1.0.0.apk` and
  `FlexiVault-1.0.0.apk.sha256`.
- GHCR contains `latest`, `v1.0.0` and the commit tag for the server image.

If the tag already exists, delete the remote tag and recreate it only after
understanding that users may already have downloaded the old release.

## 7. Self-host with Coolify

[`docker-compose.coolify.yml`](../docker-compose.coolify.yml) pulls the published image:

```yaml
image: ghcr.io/scshiv29-dev/flexivault-server:${FLEXIVAULT_IMAGE_TAG:-latest}
```

Set `FLEXIVAULT_IMAGE_TAG` to a release tag such as `v1.0.0` for reproducible
deployments, or to `edge` to follow `main`. Keep the `flexivault-data` volume;
it holds SQLite, the JWT key and the server encryption key.

To deploy without Coolify:

```bash
docker run -d \
  --name flexivault-server \
  -p 8787:8787 \
  -v flexivault-data:/data \
  -e REGISTRATION_OPEN=true \
  ghcr.io/scshiv29-dev/flexivault-server:v1.0.0
```

See [`COOLIFY.md`](COOLIFY.md) for domains, backups and environment variables.

## 8. Verify a release

```powershell
# APK
& "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --print-certs `
  FlexiVault-1.0.0.apk
Get-FileHash FlexiVault-1.0.0.apk -Algorithm SHA256

# Compare with the .sha256 file on the release page.
```

```bash
# Server image
docker buildx imagetools inspect \
  ghcr.io/scshiv29-dev/flexivault-server:v1.0.0
```

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Release workflow fails at “Require signing secrets” | Add all four Android signing secrets, then re-run the workflow. |
| Release contains an unsigned APK | The keystore step was skipped. Do not distribute it; fix the secrets and rebuild. |
| APK will not install over an older build | The signing keys differ. Uninstall the old app, or use the original keystore. |
| `versionCode` already exists | Increment it in `app.json` and `android/app/build.gradle`, commit, and tag a new version. |
| GHCR pull is denied | The package is private. Make it public or add registry credentials in Coolify. |
| Coolify still runs the old server | `FLEXIVAULT_IMAGE_TAG` points at the old tag, or `latest` was not re-pulled. Re-pull/redeploy. |
| No release assets | The workflow ran manually instead of from a `v*` tag; manual runs only upload an Actions artifact. |

## Related documents

- [`AUTOFILL.md`](AUTOFILL.md) — Android autofill design, security model and
  device-test checklist.
- [`COOLIFY.md`](COOLIFY.md) — self-hosting the server on Coolify.
- [`IMPORTING.md`](IMPORTING.md) — password-manager import formats.
