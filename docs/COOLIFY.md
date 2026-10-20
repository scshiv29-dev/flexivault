# Deploy the FlexiVault server on Coolify

This guide uses Coolify's Git-based **Docker Compose** deployment. The server
image is built by GitHub Actions and published to the GitHub Container Registry
(GHCR). SQLite stays on a named Docker volume, so redeploying does not touch
accounts or vault data.

Coolify reference:
[Docker Compose](https://coolify.io/docs/applications/builds/docker-compose) and
[Docker registries](https://coolify.io/docs/applications/builds/docker-registries).

## What gets deployed

```text
Internet
   │  HTTPS 443 (Coolify proxy / Let's Encrypt)
   ▼
Coolify proxy ──► server container :8787 ──► flexivault-data volume
                                             ├── flexivault.sqlite
                                             ├── jwt.key
                                             └── encryption.key
```

The mobile app and extension upload ciphertext. The server never receives the
master password or the vault key.

## 1. Prerequisites

- A working Coolify server with its proxy and HTTPS enabled.
- DNS control for the domain, for example `vault.example.com`.
- TCP ports 80 and 443 open on the Coolify host.
- The FlexiVault repository on GitHub.
- The published image:
  `ghcr.io/scshiv29-dev/flexivault-server`.

The release workflow publishes `latest` and the release tag (for example
`v1.0.0`). The server-image workflow publishes `edge` from `main`. Prefer a
release tag for production.

The GHCR package can be public or private. If it is private, create a GitHub
personal access token with `read:packages` and log in under **Registries** in
Coolify, as described in
[Coolify's registry guide](https://coolify.io/docs/applications/builds/docker-registries).
If the package is public, no registry login is needed.

## 2. Create the Coolify application

1. Open the target project and environment.
2. Select **+ New** and choose your GitHub repository.
3. Select branch `main`.
4. Set the build strategy to **Compose** (**Docker Compose**).
5. Set **Base Directory** to `/`.
6. Set **Docker Compose Location** to `docker-compose.coolify.yml`.
   The path is relative to the base directory; do not use a leading slash.
7. Leave **Compose deployment** on the normal managed mode. Do **not** choose
   **Raw (deploy file as-is)**; Coolify must add its proxy labels and networking.
8. Save the resource and inspect **Docker Compose Content**. It should contain
   one service named `server`.

Do not add a top-level `name:` or `container_name:` to the Coolify compose file.
Coolify controls the Compose project name and uses it for containers, networks
and the volume prefix. A fixed name can make Coolify look for the wrong
container or reuse another stack's names.

Do not add a `ports:` mapping. The compose file uses `expose: 8787`; Coolify's
proxy reaches the container over the internal network. Publishing 8787 on the
host bypasses the proxy and exposes the server directly.

If you build from a checkout instead of GHCR, comment out both the `image:` and
`pull_policy:` lines in the compose file and uncomment the `build:` block. The
normal source-build compose file at the repository root is an alternative.

## 3. Environment variables

Coolify creates editable variables for the `${...}` entries in the compose file.
Set:

| Variable | Value |
| --- | --- |
| `FLEXIVAULT_IMAGE_TAG` | `v1.0.0` for production, or `latest` / `edge` |
| `SERVER_NAME` | `FlexiVault` |
| `REGISTRATION_OPEN` | `true` until your first account exists |
| `CORS_ORIGINS` | `*` for the mobile app and extension |
| `TOKEN_TTL_SECONDS` | `2592000` (30 days) |
| `MAX_VAULT_BYTES` | `8388608` (8 MiB) |
| `MAX_ITEMS` | `5000` |
| `TRUST_PROXY` | `true`; Coolify terminates TLS and overwrites `X-Forwarded-For` |
| `JWT_SECRET` | empty, or 32+ random bytes |
| `ENCRYPTION_SECRET` | empty, or 32+ random bytes |

`CORS_ORIGINS=*` is safe here because authentication uses bearer tokens, not
cookies. Pin a specific origin only if you add a browser client that needs it.

Leaving `JWT_SECRET` and `ENCRYPTION_SECRET` empty makes the server generate them
into `/data` on first start and reuse them on every boot. Back up the volume:
losing `ENCRYPTION_SECRET` makes stored server-side TOTP secrets unreadable;
losing `JWT_SECRET` signs users out.

After the first account is created, set `REGISTRATION_OPEN=false` and redeploy.

## 4. Assign the domain

In the application's **Domains** section:

1. Select **Add domain**.
2. Choose the receiving service `server`.
3. Enter `https://vault.example.com:8787`.

The `:8787` suffix is the **internal container port** that Coolify's proxy
routes to. It is not a public port and does not appear in the browser URL. If
the Coolify UI has a separate internal-port field, enter `8787` there instead.

Do not use `https://vault.example.com` without the port (unless the UI's
separate port field is set to `8787`); the proxy would try the container on port
80 and return **No available server**.

Point the DNS `A`/`AAAA` record for `vault.example.com` at the Coolify host
before deploying.

The compose file deliberately does **not** declare a `SERVICE_FQDN_*` variable.
Use the **Domains** UI. If you prefer Coolify's generated domain variables,
follow the official Docker Compose guide and add the correctly named variable
for service `server` and port `8787`; do not set it to an empty self-reference.

## 5. Deploy and verify

Select **Deploy** and open **Deployment Logs**. When the deployment succeeds,
open **Runtime Logs**. A healthy start looks like:

```text
FlexiVault server listening on http://localhost:8787
Data directory: /data
```

Check the public endpoint:

```bash
curl -fsS https://vault.example.com/api/health
# {"ok":true,"name":"FlexiVault",...}

curl -fsS https://vault.example.com/api/server-info
```

In the mobile app, open **Settings → Server** and enter:

- Server URL: `https://vault.example.com`
- Email: your account email
- Master password: your vault master password

If the account does not exist, the app creates it and uploads the encrypted
vault. On another device use **Connect** on the welcome screen.

If the container is running but the domain shows **No available server**, see
[Coolify's troubleshooting guide](https://coolify.io/docs/troubleshoot/applications/no-available-server)
and check that the domain includes internal port `8787`, the service is healthy,
and the process listens on `0.0.0.0`.

## 6. Persistent data and backups

The compose file declares:

```yaml
volumes:
  - flexivault-data:/data
```

Coolify prefixes the Docker volume name with the stack name. Find it on the
host:

```bash
docker volume ls | grep -i flexivault
docker ps --format '{{.Names}}' | grep -i flexivault
```

If you deployed an earlier revision of this compose file that declared
`name: flexivault`, the old volume may be named `flexivault_flexivault-data`.
The current file deliberately lets Coolify choose the project name, so a new
deployment can use a different volume name. If the app appears empty after
updating, do not delete either volume: stop the new container, copy the data
from the old volume into the new one, then start it again. Keeping the old
volume attached through an explicit Compose volume name is also possible, but
only do that when you are sure no other stack uses it.

Stop the container before copying the volume:

```bash
docker stop <container-name>
docker run --rm \
  -v <volume-name>:/data \
  -v "$PWD":/backup \
  alpine tar czf "/backup/flexivault-backup-$(date +%F).tgz" -C /data .
docker start <container-name>
```

`/data` contains `flexivault.sqlite`, `jwt.key` and `encryption.key`. Keep all
three together. To restore, create an empty volume, extract the archive into it,
and start the service:

```bash
docker volume create <new-volume-name>
docker run --rm \
  -v <new-volume-name>:/data \
  -v "$PWD":/backup \
  alpine tar xzf /backup/flexivault-backup-YYYY-MM-DD.tgz -C /data
```

Back up the volume with Coolify's backup feature if your installation provides
one; the commands above are the fallback. Do not place SQLite on NFS or another
network filesystem.

### Volume permission errors

The image runs as UID/GID `1000` (`node`). A normal named volume inherits that
ownership from the image. If an older volume is root-owned and the logs show
`EACCES`, `SQLITE_CANTOPEN` or `permission denied` for `/data`, repair it while
the container is stopped:

```bash
docker run --rm -v <volume-name>:/data alpine chown -R 1000:1000 /data
```

Then deploy again. A bind-mounted host directory must also be writable by UID
1000; the named volume in the compose file is the safer choice.

## 7. Updates

For a pinned deployment:

1. Wait for the new GitHub release (for example `v1.0.1`).
2. Change `FLEXIVAULT_IMAGE_TAG` to `v1.0.1` in Coolify.
3. Click **Redeploy**. `pull_policy: always` fetches the new image.

With `FLEXIVAULT_IMAGE_TAG=latest`, redeploy after a release; the compose file
forces a pull. `edge` follows `main` and is not recommended for production.

There is no database migration step for normal updates. Keep the same volume;
do not change `DATA_DIR` unless you also move the data.

If you changed `docker-compose.coolify.yml` in Git, commit and push it, reload
the compose definition in Coolify, and redeploy.

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| Compose file not found | **Base Directory** `/` and **Docker Compose Location** `docker-compose.coolify.yml` (no leading slash). |
| `pull access denied` / `unauthorized` | The GHCR package is private. Make it public or add a `read:packages` token under **Registries**. |
| Container `Exited (1)` immediately | Open **Runtime Logs**. Check for `EACCES`/`SQLITE_CANTOPEN` (volume ownership), `Cannot find module` (wrong image tag), or `EADDRINUSE` (port conflict). |
| Compose uses an unexpected stack name | Remove any top-level `name:` or `container_name:` from the Coolify compose file; Coolify must control the project name. |
| Domain is empty after deploy | Do not set `SERVICE_FQDN_SERVER_8787` to an empty self-reference. Use the **Domains** UI, or configure Coolify's generated variable as described in its Docker Compose guide. |
| `No available server` / `502` | Domain must route to internal port `8787`; container must be healthy and listen on `0.0.0.0`. |
| `exec format error` | The image architecture does not match the server. Use the amd64 or arm64 multi-arch image; do not force a single-arch digest. |
| Health check fails | `DATA_DIR=/data` must be writable by UID 1000; inspect `docker inspect` health output and runtime logs. |
| Old server after deploy | `FLEXIVAULT_IMAGE_TAG` still points at the old tag, or the image was cached. Redeploy; `pull_policy: always` should fetch it. |
| `SQLITE_BUSY` or locked database | Only one container may use the SQLite volume. Do not scale the service to multiple replicas. |
| Registration rejected | `REGISTRATION_OPEN=false`; create the first account, or temporarily enable registration. |
| Sync rejected with `revision_mismatch` | Normal conflict handling; the app merges and retries. Persistent errors usually mean two clients are writing at once. |
| TLS certificate not issued | DNS does not point at the Coolify host, or ports 80/443 are closed. |
| Data disappeared after redeploy | The named volume was not attached. Check the compose volume mapping; never use an ephemeral container path for `/data`. |
| Permissions errors on a bind mount | Use the named volume, or make the host directory writable by UID 1000. |

For proxy, domain and container-startup failures, also see:
[Coolify troubleshooting: No available server](https://coolify.io/docs/troubleshoot/applications/no-available-server).

## 9. Security checklist

- [ ] HTTPS is active; the app URL starts with `https://`.
- [ ] `REGISTRATION_OPEN=false` after creating your account.
- [ ] `JWT_SECRET` and `ENCRYPTION_SECRET` are either generated in the volume
      or stored in a password manager and backed up.
- [ ] The data volume is included in backups, and a restore has been tested.
- [ ] Port `8787` is not published on the host; only the Coolify proxy is
      publicly reachable.
- [ ] The GHCR package is public or accessed with a least-privilege
      `read:packages` token.
- [ ] The server is single-node; do not enable horizontal scaling.

## Related

- [FlexiVault releases and GHCR images](PUBLISHING.md)
- [Android autofill](AUTOFILL.md)
- [Coolify Docker Compose documentation](https://coolify.io/docs/applications/builds/docker-compose)
