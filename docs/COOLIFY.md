# Deploy the FlexiVault server on Coolify

Coolify runs the zero-dependency Node server from `server/Dockerfile` and puts
its own TLS reverse proxy in front of it. SQLite lives on a persistent Docker
volume, so redeploying the app does not touch accounts or vault data.

Use this guide after the repository is on GitHub. Coolify needs a repository it
can clone; it does not need a prebuilt image.

## What you get

```
Internet
   │  HTTPS (Coolify proxy / Let's Encrypt)
   ▼
Coolify proxy ──► server container :8787 ──► flexivault-data volume
                                             ├── flexivault.sqlite
                                             ├── jwt.key
                                             └── encryption.key
```

The app only uploads ciphertext. The server never receives the master password
or the vault key.

## 1. Prepare the server repository

Make sure these files are committed and pushed:

- `server/Dockerfile`
- `server/src/`
- `server/package.json`
- `docker-compose.coolify.yml`

Do **not** commit `.env`, `server/data/`, `android/keystore.properties`, a
release keystore, or an `*.apk` / `*.aab`.

The compose file uses the repository root as its build context:

```yaml
build:
  context: ./server
  dockerfile: Dockerfile
```

## 2. Create the Coolify resource

1. Open your Coolify project and choose **New Resource**.
2. Choose **Docker Compose** (not a static site or a database).
3. Select your GitHub repository and the branch to deploy (`main`).
4. Set **Base Directory** to `/` and **Docker Compose Location** to
   `/docker-compose.coolify.yml`.
5. Leave the build pack as Docker Compose.
6. Click **Save** / **Continue**.

If Coolify asks for a compose file location before the repository is selected,
save the resource first and edit it afterwards.

## 3. Set environment variables

In the resource's **Environment Variables** tab, add or confirm:

| Variable | Value |
| --- | --- |
| `SERVER_NAME` | `FlexiVault` |
| `REGISTRATION_OPEN` | `true` for the first account |
| `CORS_ORIGINS` | `*` for the mobile app and extension |
| `TOKEN_TTL_SECONDS` | `2592000` (30 days) |
| `MAX_VAULT_BYTES` | `8388608` (8 MiB) |
| `MAX_ITEMS` | `5000` |
| `TRUST_PROXY` | `true` behind Coolify's proxy |
| `JWT_SECRET` | empty, or 32+ random bytes |
| `ENCRYPTION_SECRET` | empty, or 32+ random bytes |

Leaving `JWT_SECRET` and `ENCRYPTION_SECRET` empty makes the server generate
them into `/data` on first start and reuse them on later boots. If you set them
yourself, keep them stable and back them up: losing `ENCRYPTION_SECRET` makes
stored server-side TOTP secrets unreadable. Losing `JWT_SECRET` only signs
everyone out.

`TRUST_PROXY=true` is correct only because Coolify terminates the connection
and overwrites `X-Forwarded-For`. Do not set it when clients can reach the
container directly.

## 4. Assign a domain

In **Domains**, add:

```text
https://vault.example.com
```

and choose container port **8787**. Coolify's proxy will issue and renew the TLS
certificate. The compose file does not bind a host port; the proxy reaches the
container over the internal network.

Point the DNS `A`/`AAAA` record for `vault.example.com` at the Coolify server
before deploying. Ports 80 and 443 must be open.

If you prefer Coolify's generated domain variables, the compose file accepts
`SERVICE_FQDN_SERVER_8787`; the **Domains** UI is the simpler path.

## 5. Deploy and verify

Click **Deploy**. When the deployment finishes:

```bash
curl -fsS https://vault.example.com/api/health
# {"ok":true,"name":"FlexiVault",...}
```

Also check:

```bash
curl -fsS https://vault.example.com/api/server-info
```

In the mobile app, open **Settings → Server**, enter:

- Server URL: `https://vault.example.com`
- Email: your account email
- Master password: your vault master password

If the account does not exist, the app creates it and uploads the encrypted
vault. On a second device use **Connect** on the welcome screen.

After the first account exists, set `REGISTRATION_OPEN=false` and redeploy.
This stops anyone else from creating an account.

## 6. Persistent data and backups

The compose file declares:

```yaml
volumes:
  - flexivault-data:/data
```

Coolify may prefix the Docker volume name with the resource or stack name.
Find it on the host:

```bash
docker volume ls | grep -i flexivault
```

Back up the whole volume while the container is stopped:

```bash
docker compose -f /path/to/docker-compose.coolify.yml stop server
docker run --rm \
  -v <actual-volume-name>:/data \
  -v "$PWD":/backup \
  alpine tar czf /backup/flexivault-backup-$(date +%F).tgz -C /data .
```

`/data` contains `flexivault.sqlite`, `jwt.key` and `encryption.key`. Keep all
three together. Restore by extracting the archive into an empty volume and
starting the service.

If your Coolify installation has a backup feature, back up the volume with it;
the manual command above is the fallback.

## 7. Updates

Coolify redeploys from the selected branch. The image is rebuilt from
`server/Dockerfile`; there is no database migration step for normal updates.

When you update the app, keep the same volume. Do not change `DATA_DIR` unless
you also move the data. A container restart is safe.

## 8. Troubleshooting

| Symptom | Check |
| --- | --- |
| `502` from the proxy | Container is not listening on 8787, or the domain targets the wrong port. Inspect container logs. |
| Health check fails | `DATA_DIR=/data` must be writable by the `node` user; do not mount a root-owned directory. |
| `SQLITE_BUSY` or locked database | Only one container may use a SQLite volume. Do not scale the service to multiple replicas. |
| Registration rejected | `REGISTRATION_OPEN=false` is set; create the account first, or turn it back on temporarily. |
| Sync rejected with `revision_mismatch` | Normal conflict handling; the app merges and retries. Persistent errors usually mean two clients are writing at once. |
| TLS certificate not issued | DNS does not point at the Coolify server, or 80/443 are closed. |
| Data disappeared after redeploy | The volume was not attached. Check the compose volume mapping; never use an ephemeral container path for `/data`. |
| Permissions errors on a bind mount | Use the named volume. A bind-mounted host directory must be writable by UID 1000 (`node`). |

Do not place the SQLite database on NFS or a network filesystem. Do not run
multiple server replicas against the same database file.

## 9. Security checklist

- [ ] HTTPS is active; the app URL starts with `https://`.
- [ ] `REGISTRATION_OPEN=false` after creating your account.
- [ ] `JWT_SECRET` and `ENCRYPTION_SECRET` are either generated in the volume
      or stored in a password manager and backed up.
- [ ] The data volume is included in backups.
- [ ] The server is not exposed on a public host port in addition to the proxy.
- [ ] You have tested a restore, not just a backup.
- [ ] The server is single-node; do not enable horizontal scaling.
