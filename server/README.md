# FlexiVault server

A self-hostable, zero-dependency sync server for FlexiVault. It stores an
account row and a list of opaque, client-encrypted vault items. It never
receives the master password or the vault key.

- Node.js **22.5+** (`node:sqlite`, `node:http`, `node:crypto`)
- No npm dependencies
- SQLite database in a single data directory
- HS256 bearer tokens, scrypt auth verifiers, optional server-side TOTP

## Run locally

```bash
cd server
npm start
# FlexiVault server listening on http://localhost:8787
```

Data is written to `server/data/flexivault.sqlite` by default. Set `DATA_DIR` to
put it elsewhere.

```bash
PORT=9000 DATA_DIR=/var/lib/flexivault npm start
```

On first start the server also generates `jwt.key` and `encryption.key` in the
data directory if `JWT_SECRET` / `ENCRYPTION_SECRET` are not set. Back these up
with the database: `jwt.key` signs sessions, and `encryption.key` protects the
stored TOTP secrets.

## Docker

From the repository root:

```bash
cp .env.example .env
docker compose up -d --build
```

The compose file builds `server/Dockerfile`, publishes `${FLEXIVAULT_PORT}`
(default `8787`), and keeps the database in the `flexivault-data` volume.
Put the service behind a TLS reverse proxy before exposing it to the internet.

For Coolify, use [`../docker-compose.coolify.yml`](../docker-compose.coolify.yml)
and the step-by-step guide in [`../docs/COOLIFY.md`](../docs/COOLIFY.md).

### Caddy example

```caddy
vault.example.com {
  reverse_proxy 127.0.0.1:8787
}
```

### nginx example

```nginx
server {
  listen 443 ssl http2;
  server_name vault.example.com;

  client_max_body_size 10m;

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

Set `TRUST_PROXY=true` only when a proxy overwrites `X-Forwarded-For`; otherwise
clients can spoof the rate-limit key.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `8787` | Listen port |
| `DATA_DIR` | `server/data` | Database and generated key material |
| `SERVER_NAME` | `FlexiVault` | Name returned by `/api/health` and `/api/server-info` |
| `REGISTRATION_OPEN` | `true` | Allow new accounts |
| `INVITE_CODES` | empty | Comma-separated codes that still allow sign-up when `REGISTRATION_OPEN=false` |
| `PUBLIC_URL` | derived | Address shown on the `/connect` page and in its QR code, e.g. `https://vault.example.com` |
| `CONNECT_PAGE` | `true` | Serve the QR connect page at `/` and `/connect` |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins; `*` allows any |
| `JWT_SECRET` | generated | 32+ byte token-signing secret |
| `ENCRYPTION_SECRET` | generated | 32+ byte key for server-side TOTP secrets |
| `TOKEN_TTL_SECONDS` | `2592000` (30 days) | Bearer token lifetime |
| `MAX_VAULT_BYTES` | `8388608` (8 MiB) | Maximum JSON request body |
| `MAX_ITEMS` | `5000` | Maximum items per vault |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For` for rate limiting |
| `QUIET` | `false` | Disable request logging |

Create the account in the mobile app (`Settings → Server`). Registration is
disabled with `REGISTRATION_OPEN=false` and the server returns
`registration_closed`.

## Connect phones with a QR code

Open `https://<your server>/connect` in a browser. It shows a QR code with the
server address (you can also pre-fill an email and invite code). In the app,
tap **Scan QR code** on the *Sign in to a server* screen or in
**Settings → Server**; on Android the system camera can open the code too.

A signed-in phone can show the same kind of code for another phone:
**Settings → Server → Show QR code**.

The code is a `flexivault://connect?server=…&email=…&invite=…` link. It never
contains the master password: that password is the only thing that can decrypt
the vault, so it is typed on each device once. After that, turn on biometric
unlock so you do not have to type it again.

Behind a reverse proxy, set `PUBLIC_URL` (or `TRUST_PROXY=true` with a proxy
that sets `X-Forwarded-Proto` / `X-Forwarded-Host`) so the QR code points at
the public `https://` address rather than the container's internal one.

## Multiple users

One server holds any number of accounts. Each person signs up with their own
email and master password and gets a separate vault; no one, including the
server owner, can read another person's vault.

To let only people you choose join:

1. Set `REGISTRATION_OPEN=false` and `INVITE_CODES=some-long-random-code`.
2. Give each person the code, or open `/connect?invite=some-long-random-code`
   and let them scan it.
3. They create a vault on their phone, then join from **Settings → Server**
   (the invite field appears automatically).

Rotate or remove a code by editing `INVITE_CODES` and restarting. Existing
accounts keep working.

Manage accounts from the server (in Docker, prefix with
`docker compose exec server`):

```bash
npm run users -- list                       # email, item count, 2FA, dates
npm run users -- delete someone@example.com # removes the account and its vault
npm run users -- reset-2fa someone@example.com
```

There is no password reset: the server cannot decrypt anyone's vault.

## Data model

SQLite tables:

- `users` — email, scrypt-hashed `authHash`, KDF salt/iterations, revision,
  optional encrypted TOTP secret
- `vault_items` — `(user_id, item_id)` plus an opaque `data` envelope
- `unlock_shares` — extension TOTP quick unlock: a random share (encrypted with
  the server key), SHA-256 of a device secret, last accepted TOTP step, failure
  count and a 30-day expiry. The share alone cannot decrypt anything; the
  wrapped vault key it unlocks stays in the browser.

The server never stores item names, usernames, passwords, notes, or TOTP
secrets in plaintext. `authHash` is derived client-side from the master
password and sent over TLS; the server scrypt-hashes it again before storage.

## API

All routes are JSON under `/api` unless noted. Errors are
`{ "error": string, "code": string }`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| `GET` | `/` , `/connect` | — | HTML page with a QR code for the app (`?email=`, `?invite=` pre-fill it) |
| `GET` | `/api/health` | — | Liveness and server name |
| `GET` | `/api/server-info` | — | Registration status, `inviteRequired`, limits, server time |
| `POST` | `/api/accounts/register` | — | `{ email, authHash, kdfSalt, kdfIterations, inviteCode? }` → token + profile |
| `POST` | `/api/accounts/prelogin` | — | `{ email }` → KDF salt/iterations and `totpEnabled` |
| `POST` | `/api/accounts/login` | — | `{ email, authHash, totpCode? }` → token + profile |
| `GET` | `/api/accounts/me` | Bearer | Current profile |
| `POST` | `/api/2fa/setup` | Bearer | Create a pending TOTP secret and `otpauth://` URL |
| `POST` | `/api/2fa/enable` | Bearer | `{ code }` → `{ totpEnabled: true }` |
| `POST` | `/api/2fa/disable` | Bearer | `{ code }` → `{ totpEnabled: false }` |
| `POST` | `/api/quick-unlock` | Bearer | `{ replaceId? }` → `{ id, share, deviceSecret, expiresAt }`; needs 2FA on |
| `POST` | `/api/quick-unlock/release` | — | `{ id, deviceSecret, code }` → `{ share, token, ...profile }` |
| `POST` | `/api/quick-unlock/revoke` | — | `{ id, deviceSecret }` → `{ revoked: true }` |
| `GET` | `/api/sync` | Bearer | `{ revision, items: [{ id, data, updatedAt }] }` |
| `PUT` | `/api/sync` | Bearer | `{ baseRevision, items, force? }` → new revision |

`PUT /api/sync` replaces the whole item set. A stale `baseRevision` returns
`409 revision_mismatch` with the current revision and items so the client can
merge and retry. `force: true` skips the check and is used only for an explicit
"overwrite server" action.

Item IDs must match `^[A-Za-z0-9_-]{8,64}$`. Each `data` value must be a
`v1.<iv>.<ciphertext+tag>` envelope, at most 300,000 characters. Anything else
is rejected with `invalid_item`, so the server cannot be used as plaintext
storage by mistake.

Rate limits are in-memory and per process: registration `10/hour/IP`,
prelogin `60/15min/IP`, login `30/15min/IP` plus `15/15min/email`, sync
`240/15min/user`, quick-unlock release `30/15min/IP` plus `10/15min/share`.
A release code must be newer than the last accepted one (no replay), and five
wrong codes in a row delete the share. They reset on restart and are not shared between replicas.

## Backup and restore

Stop the container (or use `sqlite3 .backup`) and copy the whole data
directory / volume:

```bash
docker compose stop
docker run --rm -v flexivault_flexivault-data:/data -v "$PWD":/backup \
  alpine tar czf /backup/flexivault-backup.tgz -C /data .
docker compose start
```

Restore by extracting the archive into an empty volume. Keep the generated
`jwt.key` and `encryption.key` with the database.

## Security notes

- TLS is required in production. The `authHash` is a password-equivalent
  verifier for the account, even though it cannot decrypt the vault.
- The server is zero-knowledge with respect to vault item contents. It does
  learn account email, KDF parameters, item IDs, sizes, and revision counts.
- There is no password reset. Losing the master password means losing the
  vault; the server has no copy of the key.
- No email verification, password change, or account deletion endpoint is
  implemented. Delete an account with `npm run users -- delete <email>`.
- Rotating `ENCRYPTION_SECRET` invalidates stored TOTP secrets. Disable 2FA
  first or re-enroll afterwards.
- This is a single-node server. Do not run multiple replicas against one
  SQLite file.

## Tests

```bash
npm test
```

The suite starts the app on an ephemeral port with a temporary data directory
and covers registration, login, sync conflicts, envelope validation, and TOTP
setup/enable/disable.
